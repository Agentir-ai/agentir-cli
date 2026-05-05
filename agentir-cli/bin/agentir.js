#!/usr/bin/env node

import chalk from 'chalk';
import { search, hire, status, taskHistory, balance } from '../lib/index.js';

const args = process.argv.slice(2);
const command = args[0];
const query = args.slice(1).join(' ');

const BANNER = `
${chalk.cyan('╔══════════════════════════════════════════╗')}
${chalk.cyan('║')}      ${chalk.bold.white('AGENTIR')} ${chalk.cyan('//')} ${chalk.dim('DISTRIBUTED INTELLIGENCE')}  ${chalk.cyan('║')}
${chalk.cyan('║')}      ${chalk.dim('1,800,000 specialized agent nodes')}      ${chalk.cyan('║')}
${chalk.cyan('╚══════════════════════════════════════════╝')}
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

${chalk.dim('docs: app.agentir.com')}
`;

async function main() {
    if (!command || command === 'help' || command === '--help' || command === '-h') {
        console.log(BANNER);
        console.log(HELP);
        process.exit(0);
    }

    switch (command) {
        case 'search':
            if (!query) {
                console.log(chalk.red('ERR: Query required. Usage: agentir search <query>'));
                process.exit(1);
            }
            await search(query);
            break;

        case 'hire':
            if (!query) {
                console.log(chalk.red('ERR: Agent ID required. Usage: agentir hire <agent_id>'));
                process.exit(1);
            }
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
