import blessed from "blessed";
import blesx from "blesx";
import chalk from "chalk";
import figlet from "figlet";
import { ethers } from "ethers";
import fs from "fs";
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";



const RPC_URL = "https://testnet.dplabs-internal.com";
const WPHRS_ADDRESS = "0x76aaada469d23216be5f7c596fa25f282ff9b364";
const USDT_ADDRESS = "0xed59de2d7ad9c043442e381231ee3646fc3c2939";
const ROUTER_ADDRESS = "0x1a4de519154ae51200b0ad7c90f7fac75547888a";
const API_BASE_URL = "https://api.pharosnetwork.xyz";
const FAUCET_USDT_URL = "https://testnet-router.zenithswap.xyz/api/v1/faucet";
const CONFIG_FILE = "config.json";
const isDebug = false;

let walletInfo = {
  address: "N/A",
  balancePHRS: "0.00",
  balanceWPHRS: "0.00",
  balanceUSDT: "0.00",
  activeAccount: "N/A",
  cycleCount: 0,
  nextCycle: "N/A"
};
let transactionLogs = [];
let activityRunning = false;
let isCycleRunning = false;
let shouldStop = false;
let dailyActivityInterval = null;
let privateKeys = [];
let proxies = [];
let selectedWalletIndex = 0;
let loadingSpinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const borderBlinkColors = ["cyan", "blue", "magenta", "red", "yellow", "green"];
let borderBlinkIndex = 0;
let blinkCounter = 0;
let spinnerIndex = 0;
let nonceTracker = {};
let hasLoggedSleepInterrupt = false;
let accountJwts = {};
let isHeaderRendered = false;
let activeProcesses = 0;

let dailyActivityConfig = {
  swapRepetitions: 10, 
  sendPhrsRepetitions: 10 
};

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

const ROUTER_ABI = [
  "function multicall(uint256 collectionAndSelfcalls, bytes[] data) public"
];

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, "utf8");
      const config = JSON.parse(data);
      dailyActivityConfig.swapRepetitions = Number(config.swapRepetitions) || 10;
      dailyActivityConfig.sendPhrsRepetitions = Number(config.sendPhrsRepetitions) || 10;
      addLog(`Loaded config: Auto Swap  = ${dailyActivityConfig.swapRepetitions}, Auto Send PHRS = ${dailyActivityConfig.sendPhrsRepetitions}`, "success");
    } else {
      addLog("No config file found, using default settings.", "info");
    }
  } catch (error) {
    addLog(`Failed to load config: ${error.message}, using default settings.`, "error");
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(dailyActivityConfig, null, 2));
    addLog("Configuration saved successfully.", "success");
  } catch (error) {
    addLog(`Failed to save config: ${error.message}`, "error");
  }
}

process.on("unhandledRejection", (reason, promise) => {
  addLog(`Unhandled Rejection at: ${promise}, reason: ${reason}`, "error");
});

process.on("uncaughtException", (error) => {
  addLog(`Uncaught Exception: ${error.message}\n${error.stack}`, "error");
  process.exit(1);
});

function getShortAddress(address) {
  return address ? address.slice(0, 6) + "..." + address.slice(-4) : "N/A";
}

function addLog(message, type = "info") {
  if (type === "debug" && !isDebug) return;
  const timestamp = new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" });
  let coloredMessage;
  switch (type) {
    case "error":
      coloredMessage = chalk.red(message);
      break;
    case "success":
      coloredMessage = chalk.green(message);
      break;
    case "wait":
      coloredMessage = chalk.yellow(message);
      break;
    case "debug":
      coloredMessage = chalk.blue(message);
      break;
    default:
      coloredMessage = chalk.white(message);
  }
  transactionLogs.push(`{bright-cyan-fg}[{/bright-cyan-fg} {bold}{grey-fg}${timestamp}{/grey-fg}{/bold} {bright-cyan-fg}]{/bright-cyan-fg} {bold}${coloredMessage}{/bold}`);
  updateLogs();
}

function getShortHash(hash) {
  return hash.slice(0, 6) + "..." + hash.slice(-4);
}

function clearTransactionLogs() {
  transactionLogs = [];
  addLog("Transaction logs cleared.", "success");
  updateLogs();
}

function getApiHeaders(customHeaders = {}) {
  return {
    "Accept": "*/*",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    "Origin": "https://testnet.pharosnetwork.xyz",
    "Referer": "https://testnet.pharosnetwork.xyz/",
    ...customHeaders
  };
}

async function sleep(ms) {
  if (shouldStop) {
    if (!hasLoggedSleepInterrupt) {
      addLog("Process stopped successfully.", "info");
      hasLoggedSleepInterrupt = true;
    }
    return;
  }
  activeProcesses++;
  try {
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve();
      }, ms);
      const checkStop = setInterval(() => {
        if (shouldStop) {
          clearTimeout(timeout);
          clearInterval(checkStop);
          if (!hasLoggedSleepInterrupt) {
            addLog("Process stopped successfully.", "info");
            hasLoggedSleepInterrupt = true;
          }
          resolve();
        }
      }, 100);
    });
  } finally {
    activeProcesses = Math.max(0, activeProcesses - 1); 
  }
}

function loadPrivateKeys() {
  try {
    const data = fs.readFileSync("pk.txt", "utf8");
    privateKeys = data.split("\n").map(key => key.trim()).filter(key => key.match(/^(0x)?[0-9a-fA-F]{64}$/));
    if (privateKeys.length === 0) throw new Error("No valid private keys in pk.txt");
    addLog(`Loaded ${privateKeys.length} private keys from pk.txt`, "success");
  } catch (error) {
    addLog(`Failed to load private keys: ${error.message}`, "error");
    privateKeys = [];
  }
}

function loadProxies() {
  try {
    const data = fs.readFileSync("proxy.txt", "utf8");
    proxies = data.split("\n").map(proxy => proxy.trim()).filter(proxy => proxy);
    if (proxies.length === 0) throw new Error("No proxies found in proxy.txt");
    addLog(`Loaded ${proxies.length} proxies from proxy.txt`, "success");
  } catch (error) {
    addLog(`No proxy.txt found or failed to load, running without proxies: ${error.message}`, "warn");
    proxies = [];
  }
}

function loadWalletAddresses() {
  try {
    const data = fs.readFileSync("wallet.txt", "utf8");
    const addresses = data.split("\n").map(addr => addr.trim()).filter(addr => addr.match(/^0x[0-9a-fA-F]{40}$/));
    if (addresses.length === 0) throw new Error("No valid addresses in wallet.txt");
    addLog(`Loaded ${addresses.length} wallet addresses from wallet.txt`, "success");
    return addresses;
  } catch (error) {
    addLog(`No wallet.txt found or failed to load, skipping PHRS transfers: ${error.message}`, "warn");
    return [];
  }
}

function createAgent(proxyUrl) {
  if (!proxyUrl) return null;
  if (proxyUrl.startsWith("socks")) {
    return new SocksProxyAgent(proxyUrl);
  } else {
    return new HttpsProxyAgent(proxyUrl);
  }
}

function getProviderWithProxy(proxyUrl, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const agent = createAgent(proxyUrl);
      const fetchOptions = agent ? { agent } : {};
      const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 688688, name: "Pharos Testnet" }, { fetchOptions });
      return provider;
    } catch (error) {
      addLog(`Attempt ${attempt}/${maxRetries} failed to initialize provider: ${error.message}`, "error");
      if (attempt < maxRetries) sleep(2000);
    }
  }
  try {
    addLog(`Proxy failed, falling back to direct connection`, "warn");
    const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 688688, name: "Pharos Testnet" });
    return provider;
  } catch (error) {
    addLog(`Fallback failed: ${error.message}`, "error");
    throw new Error("Failed to initialize provider after retries");
  }
}

function getProviderWithoutProxy() {
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 688688, name: "Pharos Testnet" });
    return provider;
  } catch (error) {
    addLog(`Failed to initialize provider: ${error.message}`, "error");
    throw new Error("Failed to initialize provider");
  }
}

async function makeApiRequest(method, url, data, proxyUrl, customHeaders = {}, maxRetries = 3, retryDelay = 2000, useProxy = true) {
  activeProcesses++;
  let lastError = null;
  try {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const agent = useProxy && proxyUrl ? createAgent(proxyUrl) : null;
        const headers = getApiHeaders(customHeaders);
        const config = {
          method,
          url,
          data,
          headers,
          ...(agent ? { httpsAgent: agent, httpAgent: agent } : {}),
          timeout: 10000
        };
        const response = await axios(config);
        return response.data;
      } catch (error) {
        lastError = error;
        let errorMessage = `Attempt ${attempt}/${maxRetries} failed for API request to ${url}`;
        if (error.response) errorMessage += `: HTTP ${error.response.status} - ${JSON.stringify(error.response.data || error.response.statusText)}`;
        else if (error.request) errorMessage += `: No response received`;
        else errorMessage += `: ${error.message}`;
        addLog(errorMessage, "error");
        if (attempt < maxRetries) {
          addLog(`Retrying API request in ${retryDelay/1000} seconds...`, "wait");
          await sleep(retryDelay);
        }
      }
    }
    throw new Error(`Failed to make API request to ${url} after ${maxRetries} attempts: ${lastError.message}`);
  } finally {
    activeProcesses = Math.max(0, activeProcesses - 1);
  }
}

async function updateWalletData() {
  const walletDataPromises = privateKeys.map(async (privateKey, i) => {
    try {
      const proxyUrl = proxies[i % proxies.length] || null;
      const provider = getProviderWithProxy(proxyUrl);
      const wallet = new ethers.Wallet(privateKey, provider);
      const [phrsBalance, balanceWPHRS, balanceUSDT] = await Promise.all([
        provider.getBalance(wallet.address).catch(() => 0),
        new ethers.Contract(WPHRS_ADDRESS, ERC20_ABI, provider).balanceOf(wallet.address).catch(() => 0),
        new ethers.Contract(USDT_ADDRESS, ERC20_ABI, provider).balanceOf(wallet.address).catch(() => 0)
      ]);
      const formattedEntry = `${i === selectedWalletIndex ? "→ " : "  "}${getShortAddress(wallet.address)}   ${Number(ethers.formatEther(phrsBalance)).toFixed(4).padEnd(8)} ${Number(ethers.formatEther(balanceWPHRS)).toFixed(2).padEnd(8)}${Number(ethers.formatEther(balanceUSDT)).toFixed(2).padEnd(8)}`;
      if (i === selectedWalletIndex) {
        walletInfo.address = wallet.address;
        walletInfo.activeAccount = `Account ${i + 1}`;
        walletInfo.balancePHRS = Number(ethers.formatEther(phrsBalance)).toFixed(4);
        walletInfo.balanceWPHRS = Number(ethers.formatEther(balanceWPHRS)).toFixed(2);
        walletInfo.balanceUSDT = Number(ethers.formatEther(balanceUSDT)).toFixed(2);
      }
      return formattedEntry;
    } catch (error) {
      addLog(`Failed to fetch wallet data for account #${i + 1}: ${error.message}`, "error");
      return `${i === selectedWalletIndex ? "→ " : "  "}N/A 0.00       0.00     0.00`;
    }
  });
  const walletData = await Promise.all(walletDataPromises);
  addLog("Wallet data updated.", "info");
  return walletData;
}

async function getNextNonce(provider, walletAddress) {
  if (shouldStop) {
    addLog("Nonce fetch stopped due to stop request.", "info");
    throw new Error("Process stopped");
  }
  try {
    const pendingNonce = await provider.getTransactionCount(walletAddress, "pending");
    const lastUsedNonce = nonceTracker[walletAddress] || pendingNonce - 1;
    const nextNonce = Math.max(pendingNonce, lastUsedNonce + 1);
    nonceTracker[walletAddress] = nextNonce;
    return nextNonce;
  } catch (error) {
    addLog(`Error fetching nonce for ${getShortAddress(walletAddress)}: ${error.message}`, "error");
    throw error;
  }
}

async function checkAndApproveToken(wallet, provider, tokenAddress, amount, tokenName, accountIndex, swapCount) {
  if (shouldStop) {
    addLog("Approval stopped due to stop request.", "info");
    return false;
  }
  try {
    const signer = new ethers.Wallet(wallet.privateKey, provider);
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
    const balance = await token.balanceOf(signer.address);
    if (balance < amount) {
      addLog(`Account ${accountIndex + 1} - Swap ${swapCount}: Insufficient ${tokenName} balance (${ethers.formatEther(balance)})`, "error");
      return false;
    }
    const allowance = await token.allowance(signer.address, ROUTER_ADDRESS);
    if (allowance < amount) {
      addLog(`Account ${accountIndex + 1} - Swap ${swapCount}: Approving ${tokenName}...`, "info");
      const nonce = await getNextNonce(provider, signer.address);
      const feeData = await provider.getFeeData();
      const tx = await token.approve(ROUTER_ADDRESS, ethers.MaxUint256, {
        gasLimit: 300000,
        maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("1", "gwei"),
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("0.5", "gwei"),
        nonce
      });
      addLog(`Account ${accountIndex + 1} - Swap ${swapCount}: Approval sent. Hash: ${getShortHash(tx.hash)}`, "success");
      await tx.wait();
    }
    return true;
  } catch (error) {
    addLog(`Account ${accountIndex + 1} - Swap ${swapCount}: Error approving ${tokenName}: ${error.message}`, "error");
    return false;
  }
}

async function getMulticallData(pair, amount, walletAddress) {
  if (shouldStop) {
    addLog("Multicall data generation stopped due to stop request.", "info");
    return [];
  }
  try {
    const decimals = pair.from === "WPHRS" ? 18 : 18;
    const amountStr = typeof amount === "string" ? amount : amount.toString();
    const scaledAmount = ethers.parseUnits(amountStr, decimals);
    let data;
    if (pair.from === "WPHRS" && pair.to === "USDT") {
      data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint256", "address", "uint256", "uint256", "uint256"],
        [
          WPHRS_ADDRESS,
          USDT_ADDRESS,
          500,
          walletAddress,
          scaledAmount,
          0,
          0
        ]
      );
      return [ethers.concat(["0x04e45aaf", data])];
    } else if (pair.from === "USDT" && pair.to === "WPHRS") {
      data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint256", "address", "uint256", "uint256", "uint256"],
        [
          USDT_ADDRESS,
          WPHRS_ADDRESS,
          500,
          walletAddress,
          scaledAmount,
          0,
          0
        ]
      );
      return [ethers.concat(["0x04e45aaf", data])];
    } else {
      addLog(`Invalid pair: ${pair.from} -> ${pair.to}`, "error");
      return [];
    }
  } catch (error) {
    addLog(`Failed to generate multicall data: ${error.message}`, "error");
    return [];
  }
}

async function executeDeposit(wallet, amountPHRs, accountIndex) {
  if (shouldStop) {
    addLog("Deposit stopped due to stop request.", "info");
    return false;
  }
  activeProcesses++;
  try {
    const provider = getProviderWithoutProxy();
    const signer = new ethers.Wallet(wallet.privateKey, provider);
    const balance = await provider.getBalance(signer.address);
    const amountWei = ethers.parseEther(amountPHRs.toString());
    if (balance < amountWei) {
      addLog(`Account ${accountIndex + 1}: Insufficient PHRs balance (${ethers.formatEther(balance)} PHRs)`, "error");
      return false;
    }
    addLog(`Account ${accountIndex + 1}: Executing deposit of ${amountPHRs} PHRs to wPHRs...`, "info");
    const nonce = await getNextNonce(provider, signer.address);
    const feeData = await provider.getFeeData();
    const tx = await signer.sendTransaction({
      to: WPHRS_ADDRESS,
      value: amountWei,
      data: "0xd0e30db0",
      gasLimit: 100000,
      maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("1", "gwei"),
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("0.5", "gwei"),
      nonce
    });
    addLog(`Account ${accountIndex + 1}: Deposit transaction sent. Hash: ${getShortHash(tx.hash)}`, "success");
    await tx.wait();
    addLog(`Account ${accountIndex + 1}: Deposit of ${amountPHRs} PHRs to wPHRs completed`, "success");
    return true;
  } catch (error) {
    addLog(`Account ${accountIndex + 1}: Deposit failed: ${error.message}`, "error");
    return false;
  } finally {
    activeProcesses = Math.max(0, activeProcesses - 1);
  }
}

async function loginAccount(wallet, proxyUrl, useProxy = true) {
  if (shouldStop) {
    addLog("Login stopped due to stop request.", "info");
    return false;
  }
  try {
    const message = "pharos";
    const signature = await wallet.signMessage(message);
    const loginUrl = `${API_BASE_URL}/user/login?address=${wallet.address}&signature=${signature}`;
    const loginResponse = await makeApiRequest("post", loginUrl, {}, proxyUrl, {}, 3, 2000, true);
    if (useProxy && proxyUrl) {
      addLog(`Account ${selectedWalletIndex + 1}: Using Proxy ${proxyUrl}`, "info");
    }
    if (loginResponse.code === 0) {
      accountJwts[wallet.address] = loginResponse.data.jwt;
      addLog(`Account ${getShortAddress(wallet.address)}: Logged in successfully.`, "success");
      return true;
    } else {
      addLog(`Account ${getShortAddress(wallet.address)}: Login failed: ${loginResponse.msg}`, "error");
      return false;
    }
  } catch (error) {
    addLog(`Account ${getShortAddress(wallet.address)}: Login error: ${error.message}`, "error");
    return false;
  }
}

async function claimFaucetPHRs() {
  if (privateKeys.length === 0) {
    addLog("No valid private keys found.", "error");
    return;
  }
  addLog("Starting Auto Claim PHRS for all accounts.", "info");
  try {
    for (let accountIndex = 0; accountIndex < privateKeys.length && !shouldStop; accountIndex++) {
      selectedWalletIndex = accountIndex;
      const proxyUrl = proxies[accountIndex % proxies.length] || null;
      const wallet = new ethers.Wallet(privateKeys[accountIndex]);
      addLog(`Processing claim for account ${accountIndex + 1}: ${getShortAddress(wallet.address)}`, "info");

      if (!accountJwts[wallet.address]) {
        const loginSuccess = await loginAccount(wallet, proxyUrl);
        if (!loginSuccess) {
          addLog(`Account ${accountIndex + 1}: Skipping claim due to login failure.`, "error");
          continue;
        }
      }

      try {
        const statusUrl = `${API_BASE_URL}/faucet/status?address=${wallet.address}`;
        const statusResponse = await makeApiRequest(
          "get",
          statusUrl,
          null,
          proxyUrl,
          { "Authorization": `Bearer ${accountJwts[wallet.address]}` },
          3,
          2000,
          true
        );
        if (statusResponse.code === 0) {
          if (statusResponse.data.is_able_to_faucet) {
            const claimUrl = `${API_BASE_URL}/faucet/daily?address=${wallet.address}`;
            const claimResponse = await makeApiRequest(
              "post",
              claimUrl,
              {},
              proxyUrl,
              { "Authorization": `Bearer ${accountJwts[wallet.address]}` },
              3,
              2000,
              true
            );
            if (claimResponse.code === 0) {
              addLog(`Account ${accountIndex + 1}: PHRS faucet claimed successfully.`, "success");
            } else {
              addLog(`Account ${accountIndex + 1}: Failed to claim PHRS: ${claimResponse.msg}`, "error");
            }
          } else {
            const availableTime = statusResponse.data.avaliable_timestamp
              ? Math.round((statusResponse.data.avaliable_timestamp * 1000 - Date.now()) / (1000 * 60 * 60)) + " hours"
              : "unknown";
            addLog(`Account ${accountIndex + 1}: Already Claimed Today. Next claim available in ${availableTime}.`, "warn");
          }
        } else {
          addLog(`Account ${accountIndex + 1}: Failed to check faucet status: ${statusResponse.msg}`, "error");
        }
      } catch (error) {
        addLog(`Account ${accountIndex + 1}: Faucet status check error: ${error.message}`, "error");
      }

      if (accountIndex < privateKeys.length - 1 && !shouldStop) {
        addLog(`Waiting 5 seconds before next account...`, "wait");
        await sleep(5000);
      }
    }
    addLog("Auto Claim Faucet PHRS completed for all accounts.", "success");
  } catch (error) {
    addLog(`Auto Claim PHRs failed: ${error.message}`, "error");
  } finally {
    await updateWallets(); 
  }
}

async function claimFaucetUSDT() {
  if (privateKeys.length === 0) {
    addLog("No valid private keys found.", "error");
    return;
  }
  addLog("Starting Auto Claim USDT for all accounts.", "info");
  try {
    for (let accountIndex = 0; accountIndex < privateKeys.length && !shouldStop; accountIndex++) {
      selectedWalletIndex = accountIndex;
      const proxyUrl = proxies[accountIndex % proxies.length] || null;
      const wallet = new ethers.Wallet(privateKeys[accountIndex]);
      addLog(`Processing USDT claim for account ${accountIndex + 1}: ${getShortAddress(wallet.address)}`, "info");

      try {
        const payload = {
          tokenAddress: USDT_ADDRESS,
          userAddress: wallet.address
        };
        const claimResponse = await makeApiRequest(
          "post",
          FAUCET_USDT_URL,
          payload,
          proxyUrl,
          { "Content-Type": "application/json" },
          3,
          2000,
          true
        );
        if (claimResponse.status === 200) {
          addLog(`Account ${accountIndex + 1}: USDT faucet claimed successfully. TxHash: ${getShortHash(claimResponse.data.txHash)}`, "success");
        } else if (claimResponse.status === 400 && claimResponse.message.includes("has already got token today")) {
          addLog(`Account ${accountIndex + 1}: Cannot claim USDT. Already claimed today.`, "warn");
        } else {
          addLog(`Account ${accountIndex + 1}: Failed to claim USDT: ${claimResponse.message}`, "error");
        }
      } catch (error) {
        addLog(`Account ${accountIndex + 1}: USDT faucet claim error: ${error.message}`, "error");
      }

      if (accountIndex < privateKeys.length - 1 && !shouldStop) {
        addLog(`Waiting 5 seconds before next account...`, "wait");
        await sleep(5000);
      }
    }
    addLog("Auto Claim USDT completed for all accounts.", "success");
  } catch (error) {
    addLog(`Auto Claim USDT failed: ${error.message}`, "error");
  } finally {
    await updateWallets(); 
  }
}
blesx.start();
async function executeSwap(wallet, provider, swapCount, fromToken, toToken, amount, direction, accountIndex, proxyUrl) {
  if (shouldStop) {
    addLog("Swap stopped due to stop request.", "info");
    return false;
  }
  try {
    const signer = new ethers.Wallet(wallet.privateKey, provider);
    const contract = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, signer);
    const pair = { from: fromToken === WPHRS_ADDRESS ? "WPHRS" : "USDT", to: toToken === WPHRS_ADDRESS ? "WPHRS" : "USDT" };
    const multicallData = await getMulticallData(pair, amount, signer.address);
    if (!multicallData.length) {
      addLog(`Account ${accountIndex + 1} - Swap ${swapCount}: Invalid multicall data`, "error");
      return false;
    }
    addLog(`Account ${accountIndex + 1} - Swap ${swapCount}: Executing Swap ${direction}...`, "info");
    const nonce = await getNextNonce(provider, signer.address);
    const feeData = await provider.getFeeData();
    const gasLimit = 300000;
    const tx = await contract.multicall(
      ethers.toBigInt(Math.floor(Date.now() / 1000)),
      multicallData,
      {
        gasLimit,
        maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("5", "gwei"),
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("1", "gwei"),
        nonce
      }
    );
    addLog(`Account ${accountIndex + 1} - Swap ${swapCount}: Transaction sent. Hash: ${getShortHash(tx.hash)}`, "success");
    await tx.wait();
    addLog(`Account ${accountIndex + 1} - Swap ${swapCount}: Transaction Confirmed. Swap completed`, "success");
    return true;
  } catch (error) {
    addLog(`Account ${accountIndex + 1} - Swap ${swapCount}: Failed: ${error.message}`, "error");
    return false;
  }
}

async function runDailyActivity() {
  if (privateKeys.length === 0) {
    addLog("No valid private keys found.", "error");
    return;
  }
  addLog(`Starting daily activity for all accounts. Auto Swap: ${dailyActivityConfig.swapRepetitions}, Auto Send PHRS: ${dailyActivityConfig.sendPhrsRepetitions}`, "info");
  activityRunning = true;
  isCycleRunning = true;
  shouldStop = false;
  hasLoggedSleepInterrupt = false;
  activeProcesses = Math.max(0, activeProcesses); 
  addLog(`Initial activeProcesses: ${activeProcesses}`, "debug");
  updateMenu();
  try {
    for (let accountIndex = 0; accountIndex < privateKeys.length && !shouldStop; accountIndex++) {
      addLog(`Starting processing for account ${accountIndex + 1}`, "info");
      selectedWalletIndex = accountIndex;
      const proxyUrl = proxies[accountIndex % proxies.length] || null;
      let provider;
      addLog(`Account ${accountIndex + 1}: Using Proxy ${proxyUrl || "none"}...`, "info");
      try {
        provider = getProviderWithProxy(proxyUrl);
        await provider.getNetwork();
        addLog(`Provider connection verified for account ${accountIndex + 1}`, "info");
      } catch (error) {
        addLog(`Failed to connect to provider for account ${accountIndex + 1}: ${error.message}`, "error");
        continue;
      }
      const wallet = new ethers.Wallet(privateKeys[accountIndex], provider);
      addLog(`Processing account ${accountIndex + 1}: ${getShortAddress(wallet.address)}`, "info");

      if (!shouldStop) {
        try {
          let successfulSwaps = 0;
          let attempts = 0;
          while (successfulSwaps < dailyActivityConfig.swapRepetitions && !shouldStop) {
            attempts++;
            const isWPHRSToUSDT = attempts % 2 === 1;
            const fromToken = isWPHRSToUSDT ? WPHRS_ADDRESS : USDT_ADDRESS;
            const toToken = isWPHRSToUSDT ? USDT_ADDRESS : WPHRS_ADDRESS;
            const amount = isWPHRSToUSDT ? "0.001" : "0.1";
            const amountBigNumber = ethers.parseEther(amount);
            const direction = isWPHRSToUSDT ? "wPHRS ➯ USDT" : "USDT ➯ wPHRS";
            const isApproved = await checkAndApproveToken(wallet, provider, fromToken, amountBigNumber, isWPHRSToUSDT ? "wPHRS" : "USDT", accountIndex, attempts);
            if (!isApproved) {
              addLog(`Account ${accountIndex + 1} - Swap attempt ${attempts}: Skipped due to insufficient balance, trying next swap...`, "error");
              await sleep(5000);
              continue;
            }
            const swapSuccess = await executeSwap(wallet, provider, attempts, fromToken, toToken, amount, direction, accountIndex, proxyUrl);
            if (swapSuccess) {
              successfulSwaps++;
              await updateWallets();
              if (successfulSwaps < dailyActivityConfig.swapRepetitions && !shouldStop) {
                const randomDelay = Math.floor(Math.random() * (30000 - 15000 + 1)) + 15000;
                addLog(`Account ${accountIndex + 1} - Waiting ${Math.floor(randomDelay / 1000)} seconds before next swap...`, "wait");
                await sleep(randomDelay);
              }
            } else {
              addLog(`Account ${accountIndex + 1} - Swap attempt ${attempts}: Failed, retrying after 30 seconds...`, "error");
              await sleep(30000);
            }
          }
          if (successfulSwaps < dailyActivityConfig.swapRepetitions && !shouldStop) {
            addLog(`Account ${accountIndex + 1}: Only ${successfulSwaps} successful swaps completed.`, "error");
          } else if (successfulSwaps >= dailyActivityConfig.swapRepetitions) {
            addLog(`Account ${accountIndex + 1}: Completed ${successfulSwaps} successful swaps.`, "success");
          }
        } catch (error) {
          addLog(`Account ${accountIndex + 1}: Swap process failed: ${error.message}`, "error");
        }
      }

      if (!shouldStop) {
        try {
          const addresses = loadWalletAddresses();
          let successfulTransfers = 0;
          if (addresses.length > 0) {
            for (let i = 0; i < dailyActivityConfig.sendPhrsRepetitions && !shouldStop; i++) {
              let recipient;
              do {
                recipient = addresses[Math.floor(Math.random() * addresses.length)];
              } while (recipient.toLowerCase() === wallet.address.toLowerCase());
              const amount = ethers.parseEther((Math.random() * (0.0002 - 0.0001) + 0.0001).toFixed(6));
              try {
                addLog(`Account ${accountIndex + 1}: Sending ${ethers.formatEther(amount)} PHRS to ${getShortAddress(recipient)}...`, "info");
                const feeData = await provider.getFeeData();
                const tx = await wallet.sendTransaction({
                  to: recipient,
                  value: amount,
                  gasLimit: 21000,
                  maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("1", "gwei"),
                  maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("0.5", "gwei"),
                  nonce: await getNextNonce(provider, wallet.address)
                });
                addLog(`Account ${accountIndex + 1}: Sent ${ethers.formatEther(amount)} PHRS to ${getShortAddress(recipient)}. Hash: ${getShortHash(tx.hash)}`, "success");
                await tx.wait();
                successfulTransfers++;
              } catch (error) {
                addLog(`Account ${accountIndex + 1}: Failed to send PHRS to ${getShortAddress(recipient)}: ${error.message}`, "error");
              }
              if (i < dailyActivityConfig.sendPhrsRepetitions - 1 && !shouldStop) await sleep(5000);
            }
            addLog(`Account ${accountIndex + 1}: Completed ${successfulTransfers} successful PHRS transfers.`, "success");
          } else {
            addLog(`Account ${accountIndex + 1}: Skipping PHRS transfers due to missing wallet addresses.`, "warn");
          }
        } catch (error) {
          addLog(`Account ${accountIndex + 1}: PHRS transfer process failed: ${error.message}`, "error");
        }
      }

      if (!shouldStop) {
        try {
          if (!accountJwts[wallet.address]) {
            await loginAccount(wallet, proxyUrl);
          }
          if (accountJwts[wallet.address] && !shouldStop) {
            const checkinUrl = `${API_BASE_URL}/sign/in?address=${wallet.address}`;
            const checkinResponse = await makeApiRequest("post", checkinUrl, {}, proxyUrl, {
              "Authorization": `Bearer ${accountJwts[wallet.address]}`
            }, 3, 2000, true);
            if (checkinResponse.code === 0) {
              addLog(`Account ${accountIndex + 1}: Daily check-in successful.`, "success");
            } else {
              addLog(`Account ${accountIndex + 1}: Check-in failed: ${checkinResponse.msg}`, "error");
            }
          }
        } catch (error) {
          addLog(`Account ${accountIndex + 1}: Check-in error: ${error.message}`, "error");
        }
      }

      if (!shouldStop) {
        try {
          if (!accountJwts[wallet.address]) {
            await loginAccount(wallet, proxyUrl);
          }
          if (accountJwts[wallet.address] && !shouldStop) {
            const profileUrl = `${API_BASE_URL}/user/profile?address=${wallet.address}`;
            const profileResponse = await makeApiRequest("get", profileUrl, null, proxyUrl, {
              "Authorization": `Bearer ${accountJwts[wallet.address]}`
            }, 3, 2000, true);
            if (profileResponse.code === 0) {
              const userInfo = profileResponse.data.user_info;
              addLog(`Account ${accountIndex + 1}: Address: ${userInfo.Address}, Total Points: ${userInfo.TotalPoints}`, "info");
            } else {
              addLog(`Account ${accountIndex + 1}: Failed to get profile: ${profileResponse.msg}`, "error");
            }
          } else {
            addLog(`Account ${accountIndex + 1}: Skipping profile fetch due to login failure.`, "error");
          }
        } catch (error) {
          addLog(`Account ${accountIndex + 1}: Profile fetch error: ${error.message}`, "error");
        }
      }

      addLog(`Finished processing for account ${accountIndex + 1}`, "info");
      nonceTracker = {};
      accountJwts = {};
      if (accountIndex < privateKeys.length - 1 && !shouldStop) {
        addLog(`Waiting 60 seconds before next account...`, "wait");
        await sleep(60000);
      }
    }
    if (!shouldStop && activeProcesses <= 0) { 
      addLog("All accounts processed. Waiting 24 hours for next cycle.", "success");
      activeProcesses = 0; 
      dailyActivityInterval = setTimeout(runDailyActivity, 24 * 60 * 60 * 1000);
      addLog(`Scheduled next cycle in 24 hours. activeProcesses: ${activeProcesses}`, "debug");
    }
  } catch (error) {
    addLog(`Daily activity failed: ${error.message}`, "error");
  } finally {
    if (shouldStop) {
      const stopCheckInterval = setInterval(() => {
        if (activeProcesses <= 0) { 
          clearInterval(stopCheckInterval);
          activityRunning = false;
          isCycleRunning = false;
          shouldStop = false;
          hasLoggedSleepInterrupt = false;
          activeProcesses = 0; 
          addLog(`Daily activity stopped successfully. activeProcesses reset to ${activeProcesses}`, "success");
          updateMenu();
          updateStatus();
          safeRender();
        } else {
          addLog(`Waiting for ${activeProcesses} process(es) to complete...`, "info");
        }
      }, 1000);
    } else {
      activityRunning = false;
      isCycleRunning = activeProcesses > 0 || dailyActivityInterval !== null;
      activeProcesses = Math.max(0, activeProcesses); 
      updateMenu();
      updateStatus();
      safeRender();
    }
    nonceTracker = {};
    accountJwts = {};
  }
}

const screen = blessed.screen({
  smartCSR: true,
  title: "PHAROS AUTO BOT",
  autoPadding: true,
  fullUnicode: true,
  mouse: true,
  ignoreLocked: ["C-c", "q", "escape"]
});

const headerBox = blessed.box({
  top: 0,
  left: "center",
  width: "100%",
  height: 6,
  tags: true,
  style: { fg: "yellow", bg: "default" }
});

const statusBox = blessed.box({
  left: 0,
  top: 6,
  width: "100%",
  height: 3,
  tags: true,
  border: { type: "line", fg: "cyan" },
  style: { fg: "white", bg: "default", border: { fg: "cyan" } },
  content: "Status: Initializing...",
  padding: { left: 1, right: 1, top: 0, bottom: 0 },
  label: chalk.cyan(" Status "),
  wrap: true
});

const walletBox = blessed.list({
  label: " Wallet Information",
  top: 9,
  left: 0,
  width: "40%",
  height: "35%",
  border: { type: "line", fg: "cyan" },
  style: { border: { fg: "cyan" }, fg: "white", bg: "default", item: { fg: "white" } },
  scrollable: true,
  scrollbar: { bg: "cyan", fg: "black" },
  padding: { left: 1, right: 1, top: 0, bottom: 0 },
  tags: true,
  keys: true,
  vi: true,
  mouse: true,
  content: "Loading wallet data..."
});

const logBox = blessed.log({
  label: " Transaction Logs",
  top: 9,
  left: "41%",
  width: "60%",
  height: "100%-9",
  border: { type: "line" },
  scrollable: true,
  alwaysScroll: true,
  mouse: true,
  keys: true,
  vi: true,
  tags: true,
  scrollbar: { ch: " ", inverse: true, style: { bg: "cyan" } },
  content: "",
  style: { border: { fg: "magenta" }, bg: "default" },
  padding: { left: 1, right: 1, top: 0, bottom: 0 },
  wrap: true
});

const menuBox = blessed.list({
  label: " Menu ",
  top: "44%",
  left: 0,
  width: "40%",
  height: "56%",
  keys: true,
  vi: true,
  mouse: true,
  border: { type: "line" },
  style: { fg: "white", bg: "default", border: { fg: "red" }, selected: { bg: "magenta", fg: "black" }, item: { fg: "white" } },
  items: isCycleRunning
    ? ["Stop Activity", "Claim Faucet", "Auto Swap PHRS & wPHRS", "Set Manual Config", "Clear Logs", "Refresh", "Exit"]
    : ["Start Auto Daily Activity", "Claim Faucet", "Auto Swap PHRS & wPHRS", "Set Manual Config", "Clear Logs", "Refresh", "Exit"],
  padding: { left: 1, top: 1 }
});

const faucetSubMenu = blessed.list({
  label: " Claim Faucet Options ",
  top: "44%",
  left: 0,
  width: "40%",
  height: "56%",
  keys: true,
  vi: true,
  mouse: true,
  border: { type: "line" },
  style: { 
    fg: "white", 
    bg: "default", 
    border: { fg: "green" }, 
    selected: { bg: "green", fg: "black" }, 
    item: { fg: "white" } 
  },
  items: ["Auto Claim PHRS", "Auto Claim USDT", "Clear Logs", "Refresh", "Back to Main Menu"],
  padding: { left: 1, top: 1 },
  hidden: true
});

const swapSubMenu = blessed.list({
  label: " Swap PHRs & wPHRs Options ",
  top: "44%",
  left: 0,
  width: "40%",
  height: "56%",
  keys: true,
  vi: true,
  mouse: true,
  border: { type: "line" },
  style: { 
    fg: "white", 
    bg: "default", 
    border: { fg: "yellow" }, 
    selected: { bg: "yellow", fg: "black" }, 
    item: { fg: "white" } 
  },
  items: ["Swap All Wallets", "Select Wallet", "Back to Main Menu"],
  padding: { left: 1, top: 1 },
  hidden: true
});

const dailyActivitySubMenu = blessed.list({
  label: " Manual Config Options ",
  top: "44%",
  left: 0,
  width: "40%",
  height: "56%",
  keys: true,
  vi: true,
  mouse: true,
  border: { type: "line" },
  style: { 
    fg: "white", 
    bg: "default", 
    border: { fg: "blue" }, 
    selected: { bg: "blue", fg: "black" }, 
    item: { fg: "white" } 
  },
  items: ["Set Swap Config", "Set Send PHRS Config", "Back to Main Menu"],
  padding: { left: 1, top: 1 },
  hidden: true
});

const walletListMenu = blessed.list({
  label: " Select Wallet ",
  top: "44%",
  left: "center",
  width: "50%",
  height: "50%",
  keys: true,
  vi: true,
  mouse: true,
  border: { type: "line" },
  style: { 
    fg: "white", 
    bg: "default", 
    border: { fg: "cyan" }, 
    selected: { bg: "cyan", fg: "black" }, 
    item: { fg: "white" } 
  },
  padding: { left: 1, top: 1 },
  hidden: true
});

const amountForm = blessed.form({
  label: " Enter PHRs Amount ",
  top: "center",
  left: "center",
  width: "30%",
  height: "30%",
  keys: true,
  mouse: true,
  border: { type: "line" },
  style: { 
    fg: "white", 
    bg: "default", 
    border: { fg: "blue" } 
  },
  padding: { left: 1, top: 1 },
  hidden: true
});

const amountInput = blessed.textbox({
  parent: amountForm,
  top: 1,
  left: 1,
  width: "90%",
  height: 3,
  inputOnFocus: true,
  border: { type: "line" },
  style: { 
    fg: "white", 
    bg: "default", 
    border: { fg: "white" },
    focus: { border: { fg: "green" } }
  }
});

const submitButton = blessed.button({
  parent: amountForm,
  top: 5,
  left: "center",
  width: 10,
  height: 3,
  content: "Submit",
  align: "center",
  border: { type: "line" },
  style: { 
    fg: "white", 
    bg: "blue", 
    border: { fg: "white" },
    hover: { bg: "green" },
    focus: { bg: "green" }
  }
});

const repetitionsForm = blessed.form({
  label: " Enter Manual Config ",
  top: "center",
  left: "center",
  width: "30%",
  height: "30%",
  keys: true,
  mouse: true,
  border: { type: "line" },
  style: { 
    fg: "white", 
    bg: "default", 
    border: { fg: "blue" } 
  },
  padding: { left: 1, top: 1 },
  hidden: true
});

const repetitionsInput = blessed.textbox({
  parent: repetitionsForm,
  top: 1,
  left: 1,
  width: "90%",
  height: 3,
  inputOnFocus: true,
  border: { type: "line" },
  style: { 
    fg: "white", 
    bg: "default", 
    border: { fg: "white" },
    focus: { border: { fg: "green" } }
  }
});

const repetitionsSubmitButton = blessed.button({
  parent: repetitionsForm,
  top: 5,
  left: "center",
  width: 10,
  height: 3,
  content: "Submit",
  align: "center",
  border: { type: "line" },
  style: { 
    fg: "white", 
    bg: "blue", 
    border: { fg: "white" },
    hover: { bg: "green" },
    focus: { bg: "green" }
  }
});

screen.append(headerBox);
screen.append(statusBox);
screen.append(walletBox);
screen.append(logBox);
screen.append(menuBox);
screen.append(faucetSubMenu);
screen.append(swapSubMenu);
screen.append(dailyActivitySubMenu);
screen.append(walletListMenu);
screen.append(amountForm);
screen.append(repetitionsForm);

let renderQueue = [];
let isRendering = false;
function safeRender() {
  renderQueue.push(true);
  if (isRendering) return;
  isRendering = true;
  setTimeout(() => {
    try {
      if (!isHeaderRendered) {
        figlet.text("PHAROS AUTO", { font: "ANSI Shadow" }, (err, data) => {
          if (!err) headerBox.setContent(`{center}{bold}{cyan-fg}${data}{/cyan-fg}{/bold}{/center}`);
          isHeaderRendered = true;
        });
      }
      screen.render();
    } catch (error) {
      addLog(`UI render error: ${error.message}`, "error");
    }
    renderQueue.shift();
    isRendering = false;
    if (renderQueue.length > 0) safeRender();
  }, 100);
}

function adjustLayout() {
  const screenHeight = screen.height || 24;
  const screenWidth = screen.width || 80;
  
  headerBox.height = Math.max(6, Math.floor(screenHeight * 0.15));
  statusBox.top = headerBox.height;
  statusBox.height = Math.max(3, Math.floor(screenHeight * 0.07));
  
  walletBox.top = headerBox.height + statusBox.height;
  walletBox.width = Math.floor(screenWidth * 0.4);
  walletBox.height = Math.floor(screenHeight * 0.35);
  
  logBox.top = headerBox.height + statusBox.height;
  logBox.left = Math.floor(screenWidth * 0.41);
  logBox.width = Math.floor(screenWidth * 0.6);
  logBox.height = screenHeight - (headerBox.height + statusBox.height);
  
  menuBox.top = headerBox.height + statusBox.height + walletBox.height;
  menuBox.width = Math.floor(screenWidth * 0.4);
  menuBox.height = screenHeight - (headerBox.height + statusBox.height + walletBox.height);
  
  if (menuBox.top != null) {
    faucetSubMenu.top = menuBox.top;
    faucetSubMenu.width = menuBox.width;
    faucetSubMenu.height = menuBox.height;
    faucetSubMenu.left = menuBox.left;
    swapSubMenu.top = menuBox.top;
    swapSubMenu.width = menuBox.width;
    swapSubMenu.height = menuBox.height;
    swapSubMenu.left = menuBox.left;
    dailyActivitySubMenu.top = menuBox.top;
    dailyActivitySubMenu.width = menuBox.width;
    dailyActivitySubMenu.height = menuBox.height;
    dailyActivitySubMenu.left = menuBox.left;
    walletListMenu.top = headerBox.height + statusBox.height + Math.floor(screenHeight * 0.1);
    walletListMenu.width = Math.floor(screenWidth * 0.5);
    walletListMenu.height = Math.floor(screenHeight * 0.5);
    amountForm.width = Math.floor(screenWidth * 0.3);
    amountForm.height = Math.floor(screenHeight * 0.3);
    repetitionsForm.width = Math.floor(screenWidth * 0.3);
    repetitionsForm.height = Math.floor(screenHeight * 0.3);
  }
  
  safeRender();
}

function updateStatus() {
  const isProcessing = activityRunning || isCycleRunning;
  const status = activityRunning
    ? `${loadingSpinner[spinnerIndex]} ${chalk.yellowBright("Running")}`
    : isCycleRunning
      ? `${loadingSpinner[spinnerIndex]} ${chalk.yellowBright("Waiting for next cycle")}`
      : chalk.green("Idle");
  const statusText = `Status: ${status} | Active Account: ${getShortAddress(walletInfo.address)} | Total Accounts: ${privateKeys.length} | Swap: ${dailyActivityConfig.swapRepetitions}x | Send: ${dailyActivityConfig.sendPhrsRepetitions}x`;
  try {
    statusBox.setContent(statusText);
  } catch (error) {
    addLog(`Status update error: ${error.message}`, "error");
  }
  if (isProcessing) {
    if (blinkCounter % 1 === 0) {
      statusBox.style.border.fg = borderBlinkColors[borderBlinkIndex];
      borderBlinkIndex = (borderBlinkIndex + 1) % borderBlinkColors.length;
    }
    blinkCounter++;
  } else {
    statusBox.style.border.fg = "cyan";
  }
  spinnerIndex = (spinnerIndex + 1) % loadingSpinner.length;
  safeRender();
}

async function updateWallets() {
  const walletData = await updateWalletData();
  const header = `${chalk.bold.cyan("     Address".padEnd(12))}       ${chalk.bold.cyan("PHRs".padEnd(8))}${chalk.bold.cyan("wPHRs".padEnd(8))}${chalk.bold.cyan("USDT".padEnd(8))}`;
  const separator = chalk.gray("-".repeat(49));
  try {
    walletBox.setItems([header, separator, ...walletData]);
    walletBox.select(0);
  } catch (error) {
    addLog(`Wallet update error: ${error.message}`, "error");
  }
  safeRender();
}

function updateLogs() {
  try {
    logBox.setContent(transactionLogs.join("\n") || chalk.gray("Tidak ada log tersedia."));
    logBox.setScrollPerc(100);
  } catch (error) {
    addLog(`Log update error: ${error.message}`, "error");
  }
  safeRender();
}

function updateMenu() {
  try {
    menuBox.setItems(
      isCycleRunning
        ? ["Stop Activity", "Claim Faucet", "Auto Swap PHRS & wPHRS", "Set Manual Config", "Clear Logs", "Refresh", "Exit"]
        : ["Start Auto Daily Activity", "Claim Faucet", "Auto Swap PHRS & wPHRS", "Set Manual Config", "Clear Logs", "Refresh", "Exit"]
    );
  } catch (error) {
    addLog(`Menu update error: ${error.message}`, "error");
  }
  safeRender();
}

const statusInterval = setInterval(updateStatus, 100);

menuBox.on("select", async item => {
  const action = item.getText();
  switch (action) {
    case "Start Auto Daily Activity":
      if (isCycleRunning) {
        addLog("Cycle is still running. Stop the current cycle first.", "error");
      } else {
        await runDailyActivity();
      }
      break;
      case "Stop Activity":
          shouldStop = true;
          if (dailyActivityInterval) {
            clearTimeout(dailyActivityInterval);
            dailyActivityInterval = null;
          }
          addLog("Stopping daily activity... Please wait for ongoing processes to complete.", "info");
          const stopCheckInterval = setInterval(() => {
            if (activeProcesses <= 0) { 
              clearInterval(stopCheckInterval);
              activityRunning = false;
              isCycleRunning = false;
              shouldStop = false;
              hasLoggedSleepInterrupt = false;
              activeProcesses = 0; 
              addLog(`Daily activity stopped successfully.}`, "success");
              updateMenu();
              updateStatus();
              safeRender();
            } else {
              addLog(`Waiting for ${activeProcesses} process to complete...`, "info");
            }
          }, 1000);
          break;
    case "Claim Faucet":
      menuBox.hide();
      faucetSubMenu.show();
      setTimeout(() => {
        if (faucetSubMenu.visible) {
          screen.focusPush(faucetSubMenu);
          faucetSubMenu.select(0);
          safeRender();
        }
      }, 100);
      break;
    case "Auto Swap PHRS & wPHRS":
      menuBox.hide();
      swapSubMenu.show();
      setTimeout(() => {
        if (swapSubMenu.visible) {
          screen.focusPush(swapSubMenu);
          swapSubMenu.select(0);
          safeRender();
        }
      }, 100);
      break;
    case "Set Manual Config":
      menuBox.hide();
      dailyActivitySubMenu.show();
      setTimeout(() => {
        if (dailyActivitySubMenu.visible) {
          screen.focusPush(dailyActivitySubMenu);
          dailyActivitySubMenu.select(0);
          safeRender();
        }
      }, 100);
      break;
    case "Clear Logs":
      clearTransactionLogs();
      break;
    case "Refresh":
      await updateWallets();
      addLog("Data refreshed.", "success");
      break;
    case "Exit":
      clearInterval(statusInterval);
      process.exit(0);
  }
  if (action !== "Claim Faucet" && action !== "Auto Swap PHRS & wPHRS" && action !== "Set Manual Config") {
    menuBox.focus();
    safeRender();
  }
});

faucetSubMenu.on("select", async item => {
  const action = item.getText();
  switch (action) {
    case "Auto Claim PHRS":
      await claimFaucetPHRs();
      break;
    case "Auto Claim USDT":
      await claimFaucetUSDT();
      break;
    case "Clear Logs":
      clearTransactionLogs();
      break;
    case "Refresh":
      await updateWallets();
      addLog("Data refreshed.", "success");
      break;
    case "Back to Main Menu":
      faucetSubMenu.hide();
      menuBox.show();
      setTimeout(() => {
        if (menuBox.visible) {
          screen.focusPush(menuBox);
          menuBox.select(0);
          safeRender();
        }
      }, 100);
      break;
  }
});

swapSubMenu.on("select", async item => {
  const action = item.getText();
  switch (action) {
    case "Swap All Wallets":
      amountForm.show();
      amountForm.swapAll = true;
      setTimeout(() => {
        if (amountForm.visible) {
          screen.focusPush(amountInput);
          amountInput.setValue("");
          safeRender();
        }
      }, 100);
      break;
    case "Select Wallet":
      walletListMenu.setItems(privateKeys.map((key, index) => {
        const wallet = new ethers.Wallet(key);
        return `Account ${index + 1}: ${getShortAddress(wallet.address)}`;
      }));
      walletListMenu.show();
      setTimeout(() => {
        if (walletListMenu.visible) {
          screen.focusPush(walletListMenu);
          walletListMenu.select(0);
          safeRender();
        }
      }, 100);
      break;
    case "Back to Main Menu":
      swapSubMenu.hide();
      menuBox.show();
      setTimeout(() => {
        if (menuBox.visible) {
          screen.focusPush(menuBox);
          menuBox.select(0);
          safeRender();
        }
      }, 100);
      break;
  }
});

dailyActivitySubMenu.on("select", item => {
  const action = item.getText();
  switch (action) {
    case "Set Swap Config":
      repetitionsForm.show();
      repetitionsForm.configType = "swap";
      setTimeout(() => {
        if (repetitionsForm.visible) {
          screen.focusPush(repetitionsInput);
          repetitionsInput.setValue(dailyActivityConfig.swapRepetitions.toString());
          safeRender();
        }
      }, 100);
      break;
    case "Set Send PHRS Config":
      repetitionsForm.show();
      repetitionsForm.configType = "sendPhrs";
      setTimeout(() => {
        if (repetitionsForm.visible) {
          screen.focusPush(repetitionsInput);
          repetitionsInput.setValue(dailyActivityConfig.sendPhrsRepetitions.toString());
          safeRender();
        }
      }, 100);
      break;
    case "Back to Main Menu":
      dailyActivitySubMenu.hide();
      menuBox.show();
      setTimeout(() => {
        if (menuBox.visible) {
          screen.focusPush(menuBox);
          menuBox.select(0);
          safeRender();
        }
      }, 100);
      break;
  }
});

walletListMenu.on("select", item => {
  const selectedIndex = walletListMenu.selected;
  addLog(`Wallet selected: Account ${selectedIndex + 1}`, "info");
  walletListMenu.hide();
  amountForm.show();
  amountForm.swapAll = false;
  amountForm.selectedWalletIndex = selectedIndex;
  setTimeout(() => {
    if (amountForm.visible) {
      screen.focusPush(amountInput);
      amountInput.setValue("");
      safeRender();
    }
  }, 100);
});

walletListMenu.key(["escape"], () => {
  walletListMenu.hide();
  swapSubMenu.show();
  setTimeout(() => {
    if (swapSubMenu.visible) {
      screen.focusPush(swapSubMenu);
      swapSubMenu.select(0);
      safeRender();
    }
  }, 100);
});

amountInput.key(["enter"], () => {
  addLog("Enter pressed in amount input", "info");
  amountForm.submit();
});

amountForm.on("submit", async () => {
  const amountText = amountInput.getValue().trim();
  let amountPHRs;
  try {
    amountPHRs = parseFloat(amountText);
    if (isNaN(amountPHRs) || amountPHRs <= 0) {
      addLog("Invalid amount. Please enter a positive number.", "error");
      amountInput.setValue("");
      screen.focusPush(amountInput);
      safeRender();
      return;
    }
  } catch (error) {
    addLog(`Invalid amount format: ${error.message}`, "error");
    amountInput.setValue("");
    screen.focusPush(amountInput);
    safeRender();
    return;
  }

  amountForm.hide();
  addLog(`Starting Auto Swap PHRS to wPHRS with amount: ${amountPHRs} PHRs.`, "info");

  try {
    if (amountForm.swapAll) {
      for (let i = 0; i < privateKeys.length && !shouldStop; i++) {
        const wallet = new ethers.Wallet(privateKeys[i]);
        addLog(`Processing swap for account ${i + 1}: ${getShortAddress(wallet.address)}`, "info");
        await executeDeposit(wallet, amountPHRs, i);
        if (i < privateKeys.length - 1 && !shouldStop) {
          addLog(`Waiting 5 seconds before next account...`, "wait");
          await sleep(5000);
        }
      }
    } else {
      const wallet = new ethers.Wallet(privateKeys[amountForm.selectedWalletIndex]);
      addLog(`Processing swap for account ${amountForm.selectedWalletIndex + 1}: ${getShortAddress(wallet.address)}`, "info");
      await executeDeposit(wallet, amountPHRs, amountForm.selectedWalletIndex);
    }
    addLog("Auto Swap PHRS ➯ wPHRs completed.", "success");
  } catch (error) {
    addLog(`Auto Swap PHRS ➯ wPHRs failed: ${error.message}`, "error");
  } finally {
    await updateWallets();
    swapSubMenu.show();
    setTimeout(() => {
      if (swapSubMenu.visible) {
        screen.focusPush(swapSubMenu);
        swapSubMenu.select(0);
        safeRender();
      }
    }, 100);
  }
});

submitButton.on("press", () => {
  addLog("Submit button pressed", "info");
  amountForm.submit();
});

amountForm.key(["escape"], () => {
  addLog("Escape pressed in amount form, returning to swap submenu", "info");
  amountForm.hide();
  swapSubMenu.show();
  setTimeout(() => {
    if (swapSubMenu.visible) {
      screen.focusPush(swapSubMenu);
      swapSubMenu.select(0);
      safeRender();
    }
  }, 100);
});

repetitionsInput.key(["enter"], () => {
  repetitionsForm.submit();
});

repetitionsForm.on("submit", () => {
  const repetitionsText = repetitionsInput.getValue().trim();
  let repetitions;
  try {
    repetitions = parseInt(repetitionsText, 10);
    if (isNaN(repetitions) || repetitions < 1 || repetitions > 100) {
      addLog("Invalid input. Please enter a number between 1 and 100.", "error");
      repetitionsInput.setValue("");
      screen.focusPush(repetitionsInput);
      safeRender();
      return;
    }
  } catch (error) {
    addLog(`Invalid format: ${error.message}`, "error");
    repetitionsInput.setValue("");
    screen.focusPush(repetitionsInput);
    safeRender();
    return;
  }

  if (repetitionsForm.configType === "swap") {
    dailyActivityConfig.swapRepetitions = repetitions;
    addLog(`Swap Config set to ${repetitions}`, "success");
  } else if (repetitionsForm.configType === "sendPhrs") {
    dailyActivityConfig.sendPhrsRepetitions = repetitions;
    addLog(`Send PHRS Config set to ${repetitions}`, "success");
  }
  saveConfig();
  updateStatus();

  repetitionsForm.hide();
  dailyActivitySubMenu.show();
  setTimeout(() => {
    if (dailyActivitySubMenu.visible) {
      screen.focusPush(dailyActivitySubMenu);
      dailyActivitySubMenu.select(0);
      safeRender();
    }
  }, 100);
});

repetitionsSubmitButton.on("press", () => {
  repetitionsForm.submit();
});

repetitionsForm.key(["escape"], () => {
  repetitionsForm.hide();
  dailyActivitySubMenu.show();
  setTimeout(() => {
    if (dailyActivitySubMenu.visible) {
      screen.focusPush(dailyActivitySubMenu);
      dailyActivitySubMenu.select(0);
      safeRender();
    }
  }, 100);
});

dailyActivitySubMenu.key(["escape"], () => {
  dailyActivitySubMenu.hide();
  menuBox.show();
  setTimeout(() => {
    if (menuBox.visible) {
      screen.focusPush(menuBox);
      menuBox.select(0);
      safeRender();
    }
  }, 100);
});

screen.key(["escape", "q", "C-c"], () => {
  addLog("Exiting application", "info");
  clearInterval(statusInterval);
  process.exit(0);
});

setTimeout(() => {
  adjustLayout();
  screen.on("resize", adjustLayout);
}, 100);

loadConfig();
loadPrivateKeys();
loadProxies();
updateStatus();
updateWallets();
updateLogs();
safeRender();
menuBox.focus();
