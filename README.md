# 🚀 Pharos Auto

Ethereum smart contract automation script with terminal UI and proxy support


---

## 🧰 Features

- Dynamic terminal interface (TUI) with `blessed` + `chalk`
- Direct smart contract interaction via `ethers.js`
- HTTP and SOCKS Proxy support
- Multiple wallet support (via `pk.txt` and `wallet.txt`)

---

## ⚙️ Installation

```bash
git clone https://github.com/bazelbubx/Pharos-autotx.git
cd Pharos-autotx
npm install
```

> 📝 Make sure you are using Node.js v16 or higher.

---

## 📁 File Structure

- `index.js` - Main script
- `config.json` - Network and contract configuration
- `pk.txt` - List of private keys
- `wallet.txt` - List of wallet addresses
- `package.json` - Project metadata

---

## 🔧 Configuration


### 1. `pk.txt`

```
0xYourPrivateKey1
0xYourPrivateKey2
```
---

## ▶️ Running

```bash
node index.js
```

The program will start the automated interaction process based on the provided configuration.

---

## ⚠️ Important Notes

- Never share your `pk.txt` with anyone!
- Double-check gas and proxy configurations before running.
- It is recommended to test on testnet first.

---
