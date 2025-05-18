# 🚰 Pharos Testnet Faucet Auto Tool

An automated tool for interacting with the Pharos Testnet faucet, featuring automatic wallet creation, registration, and token claiming with proxy support.

## 🌟 Features

- 🔄 Automatic wallet generation
- 📝 Automatic testnet registration
- 💧 Automatic faucet claiming
- 💰 Automatic token transfer to specified wallet
- 🔒 Proxy support for enhanced privacy
- 🧵 Multi-threaded processing (up to 10 concurrent wallets)
- 🎨 Beautiful terminal UI with status indicators

## 📋 Requirements

- Node.js v16 or higher
- npm (Node Package Manager)

## ⚙️ Installation

```bash
git clone https://github.com/bazelbubx/Pharos-autotx.git
cd Pharos-autotx/tool
```

## 🛠️ Setup

1. Install dependencies:
```bash
npm install
```

2. Create configuration files (optional):
   - `code.txt` - Your invite code (one per line)
   - `proxy.txt` - Your proxy list (one per line)

## 🚀 Usage

Run the script:
```bash
node faucet.js
```

The script will prompt you for:
1. Number of wallets to create
2. Recipient wallet address for token transfers

## 💼 Configuration Files

### code.txt (optional)
```
YOUR_INVITE_CODE
```

### proxy.txt (optional)
```
http://username:password@host:port
socks5://username:password@host:port
```
If not provided, will run in direct mode.

## ⚙️ Network Configuration

```javascript
{
  name: 'Pharos Testnet',
  chainId: 688688,
  rpcUrl: 'https://testnet.dplabs-internal.com',
  currencySymbol: 'PHRS'
}
```

## 🔄 Process Flow

1. Generate new random wallet
2. Register wallet on Pharos Testnet
3. Claim faucet tokens
4. Wait for tokens to be credited
5. Transfer tokens to specified recipient wallet
6. Repeat for specified number of wallets

## ⚠️ Important Notes

- Never share your private keys
- Use proxies to avoid rate limiting
- Test with small numbers first
- Check proxy format if using proxies
- Ensure stable internet connection

## 🔒 Security

- Private keys are generated randomly and not stored
- Proxy support for enhanced privacy
- No sensitive data is logged or saved

## 🐛 Troubleshooting

- If registration fails, check your invite code
- If faucet claim fails, wait for cooldown period
- If transfer fails, check network status
- If proxy errors occur, verify proxy format and connectivity
