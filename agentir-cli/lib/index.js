import chalk from 'chalk';
import fetch from 'node-fetch';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { createWalletClient, http } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import dotenv from 'dotenv';
dotenv.config();

const A2A_BASE = 'https://a2a.agentir.com';
const CONFIG_DIR = path.join(os.homedir(), '.agentir');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const HISTORY_FILE = path.join(CONFIG_DIR, 'history.json');

// ─────────────────────────────────────────────
// CONFIG HELPERS
// ─────────────────────────────────────────────

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
    } catch (e) {}
    return {};
}

function saveConfig(config) {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        }
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

function prompt(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

// ─────────────────────────────────────────────
// WALLET SETUP
// ─────────────────────────────────────────────

async function getWalletClient() {
    let privateKey = process.env.PRIVATE_KEY;

    if (!privateKey) {
        const config = loadConfig();
        privateKey = config.privateKey;
    }

    if (!privateKey) {
        console.log(chalk.yellow('\nNO_WALLET_CONFIGURED // First time setup\n'));
        console.log(chalk.dim('Your private key is stored locally in ~/.agentir/config.json'));
        console.log(chalk.dim('It is never transmitted anywhere.\n'));
        privateKey = await prompt(chalk.cyan('Enter your Base wallet private key (0x...): '));
        privateKey = privateKey.trim();

        if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
            console.log(chalk.red('ERR: Invalid private key format'));
            process.exit(1);
        }

        const config = loadConfig();
        config.privateKey = privateKey;
        saveConfig(config);
        console.log(chalk.green('KEY_STORED // ~/.agentir/config.json\n'));
    }

    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({
        account,
        chain: base,
        transport: http()
    });

    return { walletClient, account };
}

// ─────────────────────────────────────────────
// SEARCH
// ─────────────────────────────────────────────

export async function search(query) {
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
            const endpoint = agent.access?.endpoint || `${A2A_BASE}/?id=${agent.agent_id}`;

            console.log(`\n${chalk.white(`[${i + 1}]`)} ${chalk.bold(name)}`);
            console.log(`    ${chalk.dim('DOMAIN:')}    ${chalk.cyan(domain)}`);
            console.log(`    ${chalk.dim('EXPERTISE:')} ${expertise.substring(0, 60)}...`);
            console.log(`    ${chalk.dim('COST:')}      ${chalk.green(cost)}`);
            console.log(`    ${chalk.dim('ID:')}        ${chalk.dim(agent.agent_id)}`);
            console.log(`    ${chalk.dim('ENDPOINT:')}  ${chalk.dim(endpoint)}`);
        });

        console.log(chalk.dim('\n─'.repeat(60)));
        console.log(chalk.dim(`\nTotal fleet: ${(data.total_fleet_size || 1800000).toLocaleString()} agents`));
        console.log(chalk.cyan('\nTo hire: agentir hire <agent_id>'));
        console.log(chalk.dim('Full registry: https://agentir.com\n'));

    } catch (err) {
        spinner.stop();
        console.error(chalk.red(`ERR: NETWORK_TIMEOUT // ${err.message}`));
    }
}

// ─────────────────────────────────────────────
// HIRE — TRUE A2A (auto-payment via viem)
// ─────────────────────────────────────────────

export async function hire(agentId) {
    const id = agentId.includes('id=')
        ? agentId.split('id=')[1]
        : agentId;

    const spinner = ora(chalk.cyan(`LOCATING_NODE // ${id.substring(0, 20)}...`)).start();

    try {
        // ── Phase 1 — Discovery + x402 challenge ──
        const probeRes = await fetch(`${A2A_BASE}/?id=${encodeURIComponent(id)}`, {
            method: 'POST'
        });
        spinner.stop();

        if (probeRes.status === 404) {
            console.log(chalk.red('ERR: NODE_NOT_FOUND'));
            return;
        }

        // Parse x402 challenge from header
        const challengeB64 = probeRes.headers.get('PAYMENT-REQUIRED');
        const authHeader = probeRes.headers.get('WWW-Authenticate') || '';

        let wallet, amount, price;

        if (challengeB64) {
            // x402 — full challenge object
            const challenge = JSON.parse(Buffer.from(challengeB64, 'base64').toString());
            const paymentInfo = challenge.accepts[0];
            wallet = paymentInfo.payTo;
            amount = BigInt(paymentInfo.amount);
            price = (parseInt(paymentInfo.amount) / 1e6).toFixed(3);
        } else if (authHeader) {
            // L402 — parse WWW-Authenticate header
            wallet = authHeader.match(/invoice="([^"]+)"/)?.[1];
            price = authHeader.match(/price="([^"]+)"/)?.[1] || '0.025';
            amount = BigInt(Math.round(parseFloat(price) * 1e6));
        } else {
            console.log(chalk.red('ERR: NO_PAYMENT_CHALLENGE'));
            return;
        }

        const body = await probeRes.json().catch(() => ({}));
        const agentName = body.agent_name || body.agent_id || id;

        console.log(chalk.cyan('\n╔══ NODE_PROFILE ══════════════════════════════╗'));
        console.log(`${chalk.cyan('║')} ${chalk.bold('Agent:')}  ${agentName}`);
        console.log(`${chalk.cyan('║')} ${chalk.bold('Price:')}  ${chalk.green(price + ' USDC')} per task`);
        console.log(`${chalk.cyan('║')} ${chalk.bold('Wallet:')} ${chalk.dim(wallet?.substring(0, 20))}...`);
        console.log(chalk.cyan('╚══════════════════════════════════════════════╝\n'));

        // Get task from user
        const task = await prompt(chalk.cyan('Enter your task/prompt: '));
        if (!task.trim()) {
            console.log(chalk.dim('CANCELLED'));
            return;
        }

        // ── Phase 2 — Auto-payment via viem ──
        const paySpinner = ora(chalk.cyan('INITIATING_PAYMENT // Base Mainnet...')).start();

        const { walletClient, account } = await getWalletClient();

        console.log(chalk.dim(`\nPaying from: ${account.address.substring(0, 10)}...`));

        const txHash = await walletClient.writeContract({
            address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
            abi: [{
                name: 'transfer',
                type: 'function',
                stateMutability: 'nonpayable',
                inputs: [
                    { name: 'to', type: 'address' },
                    { name: 'amount', type: 'uint256' }
                ],
                outputs: [{ name: '', type: 'bool' }]
            }],
            functionName: 'transfer',
            args: [wallet, amount],
        });

        paySpinner.stop();
        console.log(chalk.green(`TX_BROADCAST // ${txHash.substring(0, 20)}...`));

        const waitSpinner = ora(chalk.cyan('AWAITING_CONFIRMATION // 5 seconds...')).start();
        await new Promise(r => setTimeout(r, 5000));
        waitSpinner.stop();

        // ── Phase 3 — Execute ──
        const execSpinner = ora(chalk.cyan('EXECUTING_TASK // VERIFYING_PAYMENT...')).start();

        const execRes = await fetch(`${A2A_BASE}/?id=${encodeURIComponent(id)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Payment-Hash': txHash
            },
            body: JSON.stringify({ prompt: task })
        });

        const result = await execRes.json();
        execSpinner.stop();

        if (execRes.status === 403) {
            console.log(chalk.red(`ERR: ${result.error || result || 'VERIFICATION_FAILED'}`));
            return;
        }

        console.log(chalk.cyan('\n╔══ AGENT_RESPONSE ════════════════════════════╗'));
        console.log(chalk.white(`\n${result.result}\n`));
        console.log(chalk.cyan('╚══════════════════════════════════════════════╝'));

        // Save to history
        saveHistory({
            agent_id: id,
            agent_name: agentName,
            tx_hash: txHash,
            timestamp: new Date().toISOString(),
            task: task.substring(0, 100),
            receipt: result.receipt,
            return_url: `https://agentir.com/${id}`
        });

        console.log(chalk.green('\nTASK_COMPLETE // RECEIPT_SAVED'));
        console.log(chalk.dim(`TX: ${txHash}`));
        console.log(chalk.cyan(`RETURN_TO_NODE: https://agentir.com/${id}\n`));

    } catch (err) {
        console.error(chalk.red(`ERR: ${err.message}`));
    }
}

// ─────────────────────────────────────────────
// STATUS
// ─────────────────────────────────────────────

export async function status() {
    const history = loadHistory();
    const config = loadConfig();
    let walletAddress = 'NOT_CONFIGURED';

    if (config.privateKey || process.env.PRIVATE_KEY) {
        try {
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
    console.log(chalk.dim('Discovery:  https://agentir.com'));
    console.log(chalk.dim('Docs:       https://agentir.com\n'));
}

// ─────────────────────────────────────────────
// HISTORY
// ─────────────────────────────────────────────

export async function taskHistory() {
    const tasks = loadHistory();

    if (tasks.length === 0) {
        console.log(chalk.yellow('NO_HISTORY // No tasks recorded yet'));
        return;
    }

    console.log(chalk.cyan(`\nTASK_HISTORY // ${tasks.length} RECORDS\n`));
    console.log(chalk.dim('─'.repeat(60)));

    tasks.slice(0, 10).forEach((s, i) => {
        console.log(`\n${chalk.white(`[${i + 1}]`)} ${chalk.bold(s.agent_name || s.agent_id)}`);
        console.log(`    ${chalk.dim('Date:')}    ${new Date(s.timestamp).toLocaleString()}`);
        console.log(`    ${chalk.dim('Task:')}    ${s.task}...`);
        console.log(`    ${chalk.dim('TX:')}      ${chalk.dim(s.tx_hash?.substring(0, 20))}...`);
        console.log(`    ${chalk.dim('Return:')}  ${chalk.cyan(s.return_url)}`);
    });

    console.log(chalk.dim('\n─'.repeat(60)));
    console.log(chalk.dim(`\nHistory stored at: ${HISTORY_FILE}\n`));
}

// ─────────────────────────────────────────────
// BALANCE
// ─────────────────────────────────────────────

export async function balance() {
    const config = loadConfig();
    const key = config.privateKey || process.env.PRIVATE_KEY;

    if (key) {
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
    console.log(chalk.dim('\nUSdc Contract: 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'));
    console.log(chalk.dim('Network: Base Mainnet (Chain ID: 8453)\n'));
}
