import chalk from 'chalk';
import fetch from 'node-fetch';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';

const A2A_BASE = 'https://a2a.agentir.com';
const CONFIG_DIR = path.join(os.homedir(), '.agentir');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const HISTORY_FILE = path.join(CONFIG_DIR, 'history.json');

// Config helpers
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
    } catch (e) {}
    return {};
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

// SEARCH
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

        console.log(chalk.cyan(`\nNETWORK_SCAN_COMPLETE // ${data.results_found} NODES MATCHED\n`));
        console.log(chalk.dim('─'.repeat(60)));

        data.results.slice(0, 10).forEach((agent, i) => {
            console.log(`\n${chalk.white(`[${i + 1}]`)} ${chalk.bold(agent.profile.name)}`);
            console.log(`    ${chalk.dim('DOMAIN:')}    ${chalk.cyan(agent.profile.domain || 'GENERAL')}`);
            console.log(`    ${chalk.dim('EXPERTISE:')} ${agent.profile.expertise?.substring(0, 60) || 'AI_NODE'}...`);
            console.log(`    ${chalk.dim('COST:')}      ${chalk.green(agent.access.cost_per_task)}`);
            console.log(`    ${chalk.dim('ENDPOINT:')}  ${chalk.dim(agent.access.endpoint)}`);
        });

        console.log(chalk.dim('\n─'.repeat(60)));
        console.log(chalk.dim(`\nTotal fleet: ${data.total_fleet_size.toLocaleString()} agents`));
        console.log(chalk.cyan('\nTo hire: agentir hire <endpoint_url>'));
        console.log(chalk.dim('Full registry: https://agentir.com\n'));

    } catch (err) {
        spinner.stop();
        console.error(chalk.red(`ERR: NETWORK_TIMEOUT // ${err.message}`));
    }
}

// HIRE
export async function hire(agentId) {
    // Extract agent ID from URL if full endpoint passed
    const id = agentId.includes('id=') 
        ? agentId.split('id=')[1] 
        : agentId;

    const spinner = ora(chalk.cyan(`LOCATING_NODE // ${id.substring(0, 20)}...`)).start();

    try {
        // Phase 1 — Discovery
        const res = await fetch(`${A2A_BASE}/?id=${encodeURIComponent(id)}`);
        spinner.stop();

        if (res.status === 404) {
        console.log(chalk.red('ERR: NODE_NOT_FOUND'));
        return;
         }

        // Parse L402 header: invoice="{wallet}", price="{amount}"
        const authHeader = res.headers.get('WWW-Authenticate') || '';
        const wallet = authHeader.match(/invoice="([^"]+)"/)?.[1] || '';
        const price = authHeader.match(/price="([^"]+)"/)?.[1] || '0.025';
        const body = await res.json().catch(() => ({}));

        console.log(chalk.cyan('\n╔══ NODE_PROFILE ══════════════════════════════╗'));
        console.log(`${chalk.cyan('║')} ${chalk.bold('Agent:')}  ${body.agent_id || id}`);
        console.log(`${chalk.cyan('║')} ${chalk.bold('Price:')}  ${chalk.green(price + ' USDC')} per task`);
        console.log(`${chalk.cyan('║')} ${chalk.bold('Wallet:')} ${chalk.dim(wallet.substring(0, 20))}...`);
        console.log(chalk.cyan('╚══════════════════════════════════════════════╝\n'));

        console.log(chalk.yellow('PAYMENT_REQUIRED // L402 / X-402 Standard'));
        console.log(chalk.dim(`Send ${price} USDC on Base mainnet to:`));
        console.log(chalk.white(`${wallet}\n`));

        const txHash = await prompt(chalk.cyan('Enter Base mainnet TX hash (or press Enter to cancel): '));

        if (!txHash.trim()) {
            console.log(chalk.dim('CANCELLED'));
            return;
        }

        const task = await prompt(chalk.cyan('Enter your task/prompt: '));

        if (!task.trim()) {
        console.log(chalk.dim('CANCELLED'));
        return;
        }

        const execSpinner = ora(chalk.cyan('VERIFYING_PAYMENT // CONNECTING...')).start();

        const execRes = await fetch(`${A2A_BASE}/?id=${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: {
        'Content-Type': 'text/plain',
        'X-Payment-Hash': txHash.trim()
        },
        body: task
        });

        const result = await execRes.json();
        execSpinner.stop();

        if (execRes.status === 403) {
            console.log(chalk.red(`ERR: ${result || 'VERIFICATION_FAILED'}`));
            return;
        }

        console.log(chalk.cyan('\n╔══ AGENT_RESPONSE ════════════════════════════╗'));
        console.log(chalk.white(`\n${result.result}\n`));
        console.log(chalk.cyan('╚══════════════════════════════════════════════╝'));

        // Save to history
        saveHistory({
        agent_id: id,
        agent_name: body.agent_id || id,  // ← was data.agent, change to body.agent_id
        tx_hash: txHash.trim(),
        timestamp: new Date().toISOString(),
        task: task.substring(0, 100),
        receipt: result.receipt,
        return_url: `https://agentir.com/${id}`
        });

        console.log(chalk.green('\nTASK_COMPLETE // RECEIPT_SAVED'));
        console.log(chalk.cyan(`RETURN_TO_NODE: https://agentir.com/${id}\n`));

    } catch (err) {
        console.error(chalk.red(`ERR: ${err.message}`));
    }
}

// STATUS
export async function status() {
    const history = loadHistory();

    console.log(chalk.cyan('\n╔══ AGENTIR_STATUS ════════════════════════════╗'));
    console.log(`${chalk.cyan('║')} ${chalk.bold('Network:')}  Base Mainnet`);
    console.log(`${chalk.cyan('║')} ${chalk.bold('Protocol:')} X-402 / L402`);
    console.log(`${chalk.cyan('║')} ${chalk.bold('Fleet:')}    1,800,000 agents`);
    console.log(`${chalk.cyan('║')} ${chalk.bold('Tasks:')} ${history.length} in local history`);
    console.log(`${chalk.cyan('║')} ${chalk.bold('Config:')}   ${CONFIG_DIR}`);
    console.log(chalk.cyan('╚══════════════════════════════════════════════╝\n'));

    console.log(chalk.dim('Gateway:    https://a2a.agentir.com'));
    console.log(chalk.dim('Discovery:  https://agentir.com'));
    console.log(chalk.dim('Docs:       https://agentir.com\n'));
}

// HISTORY
export async function taskHistory() {
    const tasks = loadHistory();

    if (tasks.length === 0) {
        console.log(chalk.yellow('NO_HISTORY // No Tasks recorded yet'));
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
export async function balance() {
    console.log(chalk.cyan('\nBALANCE_CHECK // Base Mainnet USDC\n'));
    console.log(chalk.dim('To check USDC: https://basescan.org'));
    console.log(chalk.dim('\nGet USDC on Base:'));
    console.log(chalk.white('  Coinbase:  https://coinbase.com'));
    console.log(chalk.white('  Uniswap:   https://app.uniswap.org'));
    console.log(chalk.dim('\nThen send to your wallet address on Base Mainnet'));
    console.log(chalk.dim('USDC Contract: 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'));
    console.log(chalk.dim('Network: Base Mainnet (Chain ID: 8453)\n'));

}
