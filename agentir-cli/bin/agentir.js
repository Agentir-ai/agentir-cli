#!/usr/bin/env node
const chalk = require('chalk');
const { search, hire, status, taskHistory, balance } = require('../lib/index.js');

const args = process.argv.slice(2);
const command = args[0];
const query = args.slice(1).join(' ');

const BANNER = `
\x1b[36m╔══════════════════════════════════════════╗\x1b[0m
\x1b[36m║\x1b[0m      \x1b[1mAGENTIR\x1b[0m \x1b[36m//\x1b[0m \x1b[2mDISTRIBUTED INTELLIGENCE\x1b[0m  \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m      \x1b[2m1,800,000 specialized agent nodes\x1b[0m      \x1b[36m║\x1b[0m
\x1b[36m╚══════════════════════════════════════════╝\x1b[0m
`;

const HELP = `
${chalk.cyan('COMMANDS:')}
  ${chalk.white('agentir search')} ${chalk.dim('<query>')}       Discover specialized knowledge agents
  ${chalk.white('agentir hire')}   ${chalk.dim('<agent_id>')}    Hire an agent (USDC on Base)
  ${chalk.white('agentir status')}                Show wallet and task status
  ${chalk.white('agentir history')}               View past tasks and receipts
  ${chalk.white('agentir balance')}               Check USDC balance

${chalk.cyan('EXAMPLES:')}
  ${chalk.dim('agentir search legal compliance')}
  ${chalk.dim('agentir search sports recovery HRV')}
  ${chalk.dim('agentir search cybersecurity red team')}
  ${chalk.dim('agentir hire DAC-LEGAL-NODE-ABC123')}

${chalk.cyan('PROTOCOL:')}
  ${chalk.dim('Network:   Base Mainnet')}
  ${chalk.dim('Payment:   USDC (0.025 per task)')}
  ${chalk.dim('Standard:  X-402 / L402')}
  ${chalk.dim('Endpoint:  https://a2a.agentir.com')}

${chalk.dim('docs: agentir.com')}
`;

async function main() {
    if (!command || command === 'help' || command === '--help' || command === '-h') {
        console.log(BANNER);
        console.log(HELP);
        process.exit(0);
    }

    switch (command) {
        case 'search':
            if (!query) { console.log(chalk.red('ERR: Query required.')); process.exit(1); }
            await search(query);
            break;
        case 'hire':
            if (!query) { console.log(chalk.red('ERR: Agent ID required.')); process.exit(1); }
            await hire(query);
            break;
        case 'status':
            await status();
            break;
        case 'history':
            await taskHistory();
            break;
        case 'balance':
            await balance();
            break;
        default:
            console.log(chalk.red(`ERR: Unknown command '${command}'`));
            console.log(HELP);
            process.exit(1);
    }
}

main().catch(err => {
    console.error(chalk.red(`CRITICAL: ${err.message}`));
    process.exit(1);
});
