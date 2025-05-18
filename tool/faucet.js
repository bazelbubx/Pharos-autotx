const { ethers } = require('ethers');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');
const randomUseragent = require('random-useragent');
const axios = require('axios');
const readline = require('readline');
const fx = require('blesx');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const MAX_THREADS = 10;

const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  white: '\x1b[37m',
  bold: '\x1b[1m',
};

const logger = {
  info: (msg) => console.log(`${colors.green}[✓] ${msg}${colors.reset}`),
  wallet: (msg) => console.log(`${colors.yellow}[➤] ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}[!] ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}[✗] ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}[+] ${msg}${colors.reset}`),
  loading: (msg) => console.log(`${colors.cyan}[⟳] ${msg}${colors.reset}`),
  step: (msg) => console.log(`${colors.white}[➤] ${msg}${colors.reset}`),
  banner: () => {
    console.log(`${colors.cyan}${colors.bold}`);
    console.log('------------------------------------------------');
    console.log('     Pharos Testnet Auto Register & Send        ');
    console.log('------------------------------------------------');
    console.log(`${colors.reset}\n`);
  },
};

const networkConfig = {
  name: 'Pharos Testnet',
  chainId: 688688,
  rpcUrl: 'https://testnet.dplabs-internal.com',
  currencySymbol: 'PHRS',
};

const getRecipientWallet = async () => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${colors.cyan}Enter the recipient wallet address: ${colors.reset}`, (answer) => {
      const address = answer.trim();
      if (!ethers.isAddress(address)) {
        logger.error('Invalid wallet address!');
        rl.close();
        resolve(null);
      } else {
        rl.close();
        resolve(address);
      }
    });
  });
};

const loadProxies = () => {
  try {
    const proxies = fs.readFileSync('proxy.txt', 'utf8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line);
    return proxies;
  } catch (error) {
    logger.warn('No proxy.txt found or failed to load, switching to direct mode');
    return [];
  }
};

const getRandomProxy = (proxies) => {
  return proxies[Math.floor(Math.random() * proxies.length)];
};

const setupProvider = (proxy = null) => {
  if (proxy) {
    logger.info(`Using proxy: ${proxy}`);
    const agent = new HttpsProxyAgent(proxy);
    return new ethers.JsonRpcProvider(networkConfig.rpcUrl, {
      chainId: networkConfig.chainId,
      name: networkConfig.name,
    }, {
      fetchOptions: { agent },
      headers: { 'User-Agent': randomUseragent.getRandom() },
    });
  } else {
    logger.info('Using direct mode (no proxy)');
    return new ethers.JsonRpcProvider(networkConfig.rpcUrl, {
      chainId: networkConfig.chainId,
      name: networkConfig.name,
    });
  }
};

const loadInviteCode = () => {
  try {
    const codes = fs.readFileSync('code.txt', 'utf8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line);
    return codes.length > 0 ? codes[0] : 'GD6MhynPbloMQtFC';
  } catch (error) {
    logger.warn('Failed to load code.txt, using default invite code');
    return 'null';
  }
};
fx.start();
const getWalletCount = async () => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${colors.cyan}Enter the number of wallets to create: ${colors.reset}`, (answer) => {
      const count = parseInt(answer);
      if (isNaN(count) || count <= 0) {
        logger.error('Invalid number of wallets!');
        rl.close();
        resolve(0);
      } else {
        rl.close();
        resolve(count);
      }
    });
  });
};

const checkBalance = async (wallet, provider) => {
  try {
    logger.step(`Checking balance for wallet: ${wallet.address}`);
    const balance = await provider.getBalance(wallet.address);
    logger.info(`PHRS balance: ${ethers.formatEther(balance)} PHRS`);
    return balance;
  } catch (error) {
    logger.error(`Failed to check balance: ${error.message}`);
    return BigInt(0);
  }
};

const transferAllBalance = async (wallet, provider, recipientWallet) => {
  try {
    const connectedWallet = wallet.connect(provider);
    const balance = await provider.getBalance(wallet.address);
    const gasPrice = BigInt(0); // Gas price is 0 on testnet
    const gasLimit = BigInt(21000);
    const gasCost = gasPrice * gasLimit;
    const amountToSend = balance - gasCost;

    if (amountToSend <= 0) {
      logger.warn(`Insufficient balance for transfer: ${ethers.formatEther(balance)} PHRS`);
      return;
    }

    logger.step(`Sending ${ethers.formatEther(amountToSend)} PHRS to ${recipientWallet}`);

    const tx = await connectedWallet.sendTransaction({
      to: recipientWallet,
      value: amountToSend,
      gasLimit,
      gasPrice,
    });

    logger.loading('Transfer transaction sent, waiting for confirmation...');
    const receipt = await tx.wait();
    logger.success(`Transfer completed: ${receipt.hash}`);

  } catch (error) {
    logger.error(`Transfer failed: ${error.message}`);
  }
};

const registerWallet = async (wallet, inviteCode, proxy = null) => {
  try {
    logger.step(`Registering wallet: ${wallet.address} with invite code: ${inviteCode}`);

    const message = "pharos";
    const signature = await wallet.signMessage(message);
    logger.step(`Signed message: ${signature}`);

    const loginUrl = `https://api.pharosnetwork.xyz/user/login?address=${wallet.address}&signature=${signature}&invite_code=${inviteCode}`;
    const headers = {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.8",
      authorization: "Bearer null",
      "sec-ch-ua": '"Chromium";v="136", "Brave";v="136", "Not.A/Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      "sec-gpc": "1",
      Referer: "https://testnet.pharosnetwork.xyz/",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "User-Agent": randomUseragent.getRandom(),
    };

    const axiosConfig = {
      method: 'post',
      url: loginUrl,
      headers,
      httpsAgent: proxy ? new HttpsProxyAgent(proxy) : null,
    };

    logger.loading('Sending registration request...');
    const loginResponse = await axios(axiosConfig);
    const loginData = loginResponse.data;

    if (loginData.code !== 0 || !loginData.data.jwt) {
      logger.error(`Registration failed: ${loginData.msg || 'Unknown error'}`);
      return null;
    }

    logger.success(`Registration successful, JWT: ${loginData.data.jwt}`);
    return loginData.data.jwt;
  } catch (error) {
    logger.error(`Registration failed for ${wallet.address}: ${error.message}`);
    return null;
  }
};

const claimFaucet = async (wallet, jwt, proxy = null) => {
  try {
    logger.step(`Checking faucet eligibility for wallet: ${wallet.address}`);

    const headers = {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.8",
      authorization: `Bearer ${jwt}`,
      "sec-ch-ua": '"Chromium";v="136", "Brave";v="136", "Not.A/Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      "sec-gpc": "1",
      Referer: "https://testnet.pharosnetwork.xyz/",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "User-Agent": randomUseragent.getRandom(),
    };

    const statusUrl = `https://api.pharosnetwork.xyz/faucet/status?address=${wallet.address}`;
    logger.loading('Checking faucet status...');
    const statusResponse = await axios({
      method: 'get',
      url: statusUrl,
      headers,
      httpsAgent: proxy ? new HttpsProxyAgent(proxy) : null,
    });
    const statusData = statusResponse.data;

    if (statusData.code !== 0 || !statusData.data) {
      logger.error(`Faucet status check failed: ${statusData.msg || 'Unknown error'}`);
      return false;
    }

    if (!statusData.data.is_able_to_faucet) {
      const nextAvailable = new Date(statusData.data.avaliable_timestamp * 1000).toLocaleString('en-US', { timeZone: 'Asia/Makassar' });
      logger.warn(`Faucet not available until: ${nextAvailable}`);
      return false;
    }

    const claimUrl = `https://api.pharosnetwork.xyz/faucet/daily?address=${wallet.address}`;
    logger.loading('Claiming faucet...');
    const claimResponse = await axios({
      method: 'post',
      url: claimUrl,
      headers,
      httpsAgent: proxy ? new HttpsProxyAgent(proxy) : null,
    });
    const claimData = claimResponse.data;

    if (claimData.code === 0) {
      logger.success(`Faucet claimed successfully for ${wallet.address}`);
      return true;
    } else {
      logger.error(`Faucet claim failed: ${claimData.msg || 'Unknown error'}`);
      return false;
    }
  } catch (error) {
    logger.error(`Faucet claim failed for ${wallet.address}: ${error.message}`);
    return false;
  }
};

async function processWallet(data) {
  try {
    // Recreate the wallet instance from private key
    const wallet = new ethers.Wallet(data.wallet.privateKey);
    const { inviteCode, proxy, recipientWallet } = data;
    const provider = setupProvider(proxy);
    const connectedWallet = wallet.connect(provider);

    logger.wallet(`Processing wallet: ${wallet.address}`);

    const jwt = await registerWallet(connectedWallet, inviteCode, proxy);
    if (!jwt) {
      logger.error(`Skipping wallet ${wallet.address} due to registration failure`);
      return null;
    }

    const faucetSuccess = await claimFaucet(wallet, jwt, proxy);
    if (faucetSuccess) {
      logger.loading('Waiting 5 seconds for faucet tokens to credit...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Check balance before transfer
      await checkBalance(wallet, provider);
      
      // Transfer all balance to recipient wallet
      await transferAllBalance(connectedWallet, provider, recipientWallet);
    }

    return {
      address: wallet.address,
      privateKey: wallet.privateKey,
      inviteCode: inviteCode,
    };
  } catch (error) {
    logger.error(`Failed to process wallet ${data.wallet.address}: ${error.message}`);
    return null;
  }
}

if (isMainThread) {
  const main = async () => {
    logger.banner();

    const walletCount = await getWalletCount();
    if (walletCount === 0) {
      return;
    }

    const recipientWallet = await getRecipientWallet();
    if (!recipientWallet) {
      return;
    }
    logger.info(`Using recipient wallet: ${recipientWallet}`);

    const inviteCode = loadInviteCode();
    logger.info(`Using invite code: ${inviteCode} for all wallets`);

    const proxies = loadProxies();
    const walletsData = [];
    const activeWorkers = new Set();
    let processedCount = 0;

    const processNextBatch = async () => {
      while (processedCount < walletCount && activeWorkers.size < MAX_THREADS) {
        const newWallet = ethers.Wallet.createRandom();
        const proxy = proxies.length ? getRandomProxy(proxies) : null;

        const worker = new Worker(__filename, {
          workerData: {
            wallet: {
              address: newWallet.address,
              privateKey: newWallet.privateKey
            },
            inviteCode,
            proxy,
            recipientWallet
          }
        });

        activeWorkers.add(worker);

        worker.on('message', (result) => {
          if (result) {
            walletsData.push(result);
          }
        });

        worker.on('error', (error) => {
          logger.error(`Worker error: ${error.message}`);
          activeWorkers.delete(worker);
          processedCount++;
          processNextBatch();
        });

        worker.on('exit', (code) => {
          activeWorkers.delete(worker);
          processedCount++;
          
          if (processedCount === walletCount) {
            logger.success('All wallets processed!');
            if (activeWorkers.size === 0) {
              logger.success('Restarting...');
              main();
            }
          } else {
            processNextBatch();
          }
        });

        // Add random delay between starting new workers
        await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
      }
    };

    await processNextBatch();
  };

  main().catch(error => {
    logger.error(`Bot failed: ${error.message}`);
    process.exit(1);
  });
} else {
  // Worker thread code
  (async () => {
    try {
      const result = await processWallet(workerData);
      if (result) {
        parentPort.postMessage(result);
      }
    } catch (error) {
      logger.error(`Worker thread error: ${error.message}`);
    } finally {
      parentPort.close();
    }
  })();
}