'use strict';
const chalk = require('chalk');
const fetch = require('node-fetch');
const ora = require('ora');
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { randomBytes } = require('crypto');
require('dotenv').config();

// viem — ESM only, use dynamic import.
// Standard x402 is a gasless signed authorization, so we only need the
// account (to sign typed data) and getAddress (to checksum-normalize).
let privateKeyToAccount, getAddress;

async function loadViem() {
    if (!privateKeyToAccount) {
        const viem = await import('viem');
        const viemAccounts = await import('viem/accounts');
        getAddress = viem.getAddress;
        privateKeyToAccount = viemAccounts.privateKeyToAccount;
    }
}

const A2A_BASE = 'https://a2a.agentir.com';
const CONFIG_DIR = path.join(os.homedir(), '.agentir');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const HISTORY_FILE = path.join(CONFIG_DIR, 'history.json');

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (e) {}
    return {};
}

function saveConfig(config) {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    } catch (e) {}
    return [];
}

function saveHistory(entry) {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const history = loadHistory();
    history.unshift(entry);
    if (history.length > 50) history.length = 50;
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

function promptPaste(question) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
    });
}

async function getWalletClient() {
    await loadViem();
    let privateKey = process.env.PRIVATE_KEY;

    if (!privateKey) {
        const config = loadConfig();
        privateKey = config.privateKey;
    }

    if (!privateKey) {
        console.log(chalk.yellow('\nNO_WALLET_CONFIGURED // First time setup\n'));
        console.log(chalk.dim('Payments are gasless: your key signs a USDC authorization — it is never'));
        console.log(chalk.dim('broadcast, needs no ETH, and is stored only in ~/.agentir/config.json.\n'));

        privateKey = await promptPaste(chalk.cyan('Paste your Base wallet private key (0x...): '));
        privateKey = privateKey.trim();

        if (!privateKey.startsWith('0x')) privateKey = '0x' + privateKey;

        if (privateKey.length !== 66) {
            console.log(chalk.red(`ERR: Invalid key length (${privateKey.length} chars, expected 66)`));
            process.exit(1);
        }

        const config = loadConfig();
        config.privateKey = privateKey;
        saveConfig(config);
        console.log(chalk.green('KEY_STORED // ~/.agentir/config.json\n'));
    }

    const account = privateKeyToAccount(privateKey);
    return { account };
}

async function search(query) {
    const spinner = ora(chalk.cyan(`SCANNING_NETWORK // ${query.toUpperCase()}`)).start();
    try {
        const res = await fetch(`${A2A_BASE}/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        spinner.stop();

        if (!data.results || data.results.length === 0) {
            console.log(chalk.yellow('ZERO_MATCH // Consider spawning a custom agent at agentir.com'));
            return;
        }

        console.log(chalk.cyan(`\nNETWORK_SCAN_COMPLETE // ${data.results_found || data.results.length} NODES MATCHED\n`));
        console.log(chalk.dim('─'.repeat(60)));

        data.results.slice(0, 10).forEach((agent, i) => {
            const name = agent.profile?.name || agent.name || agent.agent_id;
            const domain = agent.profile?.domain || agent.category || 'GENERAL';
            const expertise = agent.profile?.expertise || agent.capability || 'AI_NODE';
            const cost = agent.access?.cost_per_task || `${agent.task_price || 0.025} USDC`;

            console.log(`\n${chalk.white(`[${i + 1}]`)} ${chalk.bold(name)}`);
            console.log(`    ${chalk.dim('DOMAIN:')}    ${chalk.cyan(domain)}`);
            console.log(`    ${chalk.dim('EXPERTISE:')} ${expertise.substring(0, 60)}...`);
            console.log(`    ${chalk.dim('COST:')}      ${chalk.green(cost)}`);
            console.log(`    ${chalk.dim('ID:')}        ${chalk.dim(agent.agent_id)}`);
        });

        console.log(chalk.dim('\n─'.repeat(60)));
        console.log(chalk.dim(`\nTotal fleet: ${(data.total_fleet_size || 1800000).toLocaleString()} agents`));
        console.log(chalk.cyan('\nTo hire: agentir hire <agent_id>\n'));

    } catch (err) {
        spinner.stop();
        console.error(chalk.red(`ERR: NETWORK_TIMEOUT // ${err.message}`));
    }
}

async function hire(agentId) {
    const id = agentId.includes('id=') ? agentId.split('id=')[1] : agentId;
    const spinner = ora(chalk.cyan(`LOCATING_NODE // ${id.substring(0, 20)}...`)).start();

    try {
        const probeRes = await fetch(`${A2A_BASE}/?id=${encodeURIComponent(id)}`, { method: 'POST' });
        spinner.stop();

        if (probeRes.status === 404) { console.log(chalk.red('ERR: NODE_NOT_FOUND')); return; }

        const challengeB64 = probeRes.headers.get('PAYMENT-REQUIRED');
        if (!challengeB64) {
            console.log(chalk.red('ERR: NO_PAYMENT_CHALLENGE // expected a 402 x402 challenge'));
            return;
        }

        let paymentInfo;
        try {
            const challenge = JSON.parse(Buffer.from(challengeB64, 'base64').toString());
            paymentInfo = challenge.accepts?.[0];
        } catch (e) {}
        if (!paymentInfo) {
            console.log(chalk.red('ERR: MALFORMED_CHALLENGE'));
            return;
        }

        const wallet = paymentInfo.payTo;
        const amount = BigInt(paymentInfo.amount);
        const price  = (Number(paymentInfo.amount) / 1e6).toFixed(3);

        const body = await probeRes.json().catch(() => ({}));
        const agentName = body.agent_name || body.agent_id || id;

        console.log(chalk.cyan('\n╔══ NODE_PROFILE ══════════════════════════════╗'));
        console.log(`${chalk.cyan('║')} ${chalk.bold('Agent:')}  ${agentName}`);
        console.log(`${chalk.cyan('║')} ${chalk.bold('Price:')}  ${chalk.green(price + ' USDC')} per task`);
        console.log(`${chalk.cyan('║')} ${chalk.bold('Wallet:')} ${chalk.dim(wallet?.substring(0, 20))}...`);
        console.log(chalk.cyan('╚══════════════════════════════════════════════╝\n'));

        const { account } = await getWalletClient();

        const task = await promptPaste(chalk.cyan('Enter your task/prompt: '));
        if (!task.trim()) { console.log(chalk.dim('CANCELLED')); return; }

        // ── standard x402: sign a gasless EIP-3009 TransferWithAuthorization ──
        // No broadcast, no ETH. The facilitator verifies + settles the signed
        // authorization server-side; we just send it in PAYMENT-SIGNATURE.
        const paySpinner = ora(chalk.cyan('SIGNING_PAYMENT // gasless USDC authorization...')).start();

        const chainId = parseInt(String(paymentInfo.network || 'eip155:8453').split(':')[1], 10) || 8453;
        const asset   = paymentInfo.asset || '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
        const now     = Math.floor(Date.now() / 1000);
        // lowercasing first makes getAddress re-derive a valid checksum
        const norm = (a) => getAddress(String(a).toLowerCase());

        const authorization = {
            from: account.address,
            to: norm(wallet),
            value: String(amount),
            validAfter: '0',
            validBefore: String(now + 600),   // 10-minute window
            nonce: '0x' + randomBytes(32).toString('hex')
        };

        const signature = await account.signTypedData({
            domain: {
                name: paymentInfo.extra?.name || 'USD Coin',
                version: paymentInfo.extra?.version || '2',
                chainId,
                verifyingContract: norm(asset)
            },
            types: {
                TransferWithAuthorization: [
                    { name: 'from',        type: 'address' },
                    { name: 'to',          type: 'address' },
                    { name: 'value',       type: 'uint256' },
                    { name: 'validAfter',  type: 'uint256' },
                    { name: 'validBefore', type: 'uint256' },
                    { name: 'nonce',       type: 'bytes32' }
                ]
            },
            primaryType: 'TransferWithAuthorization',
            message: {
                from: authorization.from,
                to: authorization.to,
                value: BigInt(authorization.value),
                validAfter: BigInt(authorization.validAfter),
                validBefore: BigInt(authorization.validBefore),
                nonce: authorization.nonce
            }
        });

        const paymentPayload = {
            x402Version: 2,
            accepted: paymentInfo,
            payload: { signature, authorization }
        };
        const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');
        paySpinner.stop();
        console.log(chalk.dim(`\nPaying from: ${account.address.substring(0, 10)}... (gasless — no ETH needed)`));

        const execSpinner = ora(chalk.cyan('EXECUTING_TASK // SETTLING_PAYMENT...')).start();
        const execRes = await fetch(`${A2A_BASE}/?id=${encodeURIComponent(id)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'PAYMENT-SIGNATURE': paymentHeader },
            body: JSON.stringify({ prompt: task })
        });
        const result = await execRes.json().catch(() => ({}));
        execSpinner.stop();

        if (execRes.status !== 200) {
            const reason = result.reason ? ` // ${result.reason}` : '';
            console.log(chalk.red(`ERR: ${result.error || 'PAYMENT_FAILED'}${reason}`));
            return;
        }

        // settlement details (tx hash) come back in the PAYMENT-RESPONSE header
        let settleTx = '';
        const payResp = execRes.headers.get('PAYMENT-RESPONSE');
        if (payResp) {
            try { settleTx = JSON.parse(Buffer.from(payResp, 'base64').toString()).transaction || ''; } catch (e) {}
        }

        console.log(chalk.cyan('\n╔══ AGENT_RESPONSE ════════════════════════════╗'));
        console.log(chalk.white(`\n${result.result || result.reply || '(no content)'}\n`));
        console.log(chalk.cyan('╚══════════════════════════════════════════════╝'));

        saveHistory({
            agent_id: id,
            agent_name: agentName,
            tx_hash: settleTx,
            timestamp: new Date().toISOString(),
            task: task.substring(0, 100),
            receipt: result.receipt,
            return_url: `https://agentir.com/${id}`
        });

        console.log(chalk.green('\nTASK_COMPLETE // RECEIPT_SAVED'));
        if (settleTx) {
            console.log(chalk.dim(`Settlement TX: ${settleTx}`));
            console.log(chalk.dim(`Explorer:      https://basescan.org/tx/${settleTx}`));
        }
        console.log(chalk.cyan(`RETURN_TO_NODE: https://agentir.com/${id}\n`));

    } catch (err) {
        console.error(chalk.red(`ERR: ${err.message}`));
    }
}

async function status() {
    const history = loadHistory();
    const config = loadConfig();
    let walletAddress = 'NOT_CONFIGURED';

    if (config.privateKey || process.env.PRIVATE_KEY) {
        try {
            await loadViem();
            const key = config.privateKey || process.env.PRIVATE_KEY;
            const account = privateKeyToAccount(key);
            walletAddress = account.address;
        } catch (e) {}
    }

    console.log(chalk.cyan('\n╔══ AGENTIR_STATUS ════════════════════════════╗'));
    console.log(`${chalk.cyan('║')} ${chalk.bold('Network:')}  Base Mainnet`);
    console.log(`${chalk.cyan('║')} ${chalk.bold('Protocol:')} X-402 / L402`);
    console.log(`${chalk.cyan('║')} ${chalk.bold('Fleet:')}    1,800,000 agents`);
    console.log(`${chalk.cyan('║')} ${chalk.bold('Wallet:')}   ${chalk.dim(walletAddress.substring(0, 20))}...`);
    console.log(`${chalk.cyan('║')} ${chalk.bold('Tasks:')}    ${history.length} in local history`);
    console.log(`${chalk.cyan('║')} ${chalk.bold('Config:')}   ${CONFIG_DIR}`);
    console.log(chalk.cyan('╚══════════════════════════════════════════════╝\n'));
    console.log(chalk.dim('Gateway:    https://a2a.agentir.com'));
    console.log(chalk.dim('Discovery:  https://agentir.com\n'));
}

async function taskHistory() {
    const tasks = loadHistory();
    if (tasks.length === 0) { console.log(chalk.yellow('NO_HISTORY // No tasks recorded yet')); return; }

    console.log(chalk.cyan(`\nTASK_HISTORY // ${tasks.length} RECORDS\n`));
    console.log(chalk.dim('─'.repeat(60)));

    tasks.slice(0, 10).forEach((s, i) => {
        console.log(`\n${chalk.white(`[${i + 1}]`)} ${chalk.bold(s.agent_name || s.agent_id)}`);
        console.log(`    ${chalk.dim('Date:')}    ${new Date(s.timestamp).toLocaleString()}`);
        console.log(`    ${chalk.dim('Task:')}    ${s.task}...`);
        console.log(`    ${chalk.dim('TX:')}      ${chalk.dim(s.tx_hash?.substring(0, 20))}...`);
        console.log(`    ${chalk.dim('Return:')}  ${chalk.cyan(s.return_url)}`);
    });

    console.log(chalk.dim(`\nHistory stored at: ${HISTORY_FILE}\n`));
}

async function balance() {
    const config = loadConfig();
    const key = config.privateKey || process.env.PRIVATE_KEY;

    if (key) {
        await loadViem();
        const account = privateKeyToAccount(key);
        console.log(chalk.cyan('\nBALANCE_CHECK // Base Mainnet USDC\n'));
        console.log(chalk.dim(`Wallet: ${account.address}`));
        console.log(chalk.white(`\nhttps://basescan.org/address/${account.address}\n`));
    } else {
        console.log(chalk.cyan('\nBALANCE_CHECK // Base Mainnet USDC\n'));
        console.log(chalk.dim('No wallet configured. Run: agentir hire <agent_id>'));
    }

    console.log(chalk.dim('Get USDC on Base:'));
    console.log(chalk.white('  Coinbase:  https://coinbase.com'));
    console.log(chalk.white('  Uniswap:   https://app.uniswap.org'));
    console.log(chalk.dim('\nUSDC Contract: 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'));
    console.log(chalk.dim('Network: Base Mainnet (Chain ID: 8453)\n'));
}

module.exports = { search, hire, status, taskHistory, balance };
