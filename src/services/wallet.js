import { ethers } from 'ethers';

const ALCHEMY_API_KEY = import.meta.env.VITE_ALCHEMY_API_KEY;
const RPC_URL = `https://base-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
const ERC20_ADDRESS = '0x8D916a6AeD915Bea3F2a7BBBA9B527A4b4a32cD6';
const KEYSTORE_STORAGE_KEY = 'mind_wallet_keystore';
const ADDRESS_STORAGE_KEY = 'mind_wallet_address';

// Standard ERC20 ABI for transfer
const ERC20_ABI = [
  'function transfer(address to, uint256 amount) public returns (bool)',
  'function decimals() public view returns (uint8)',
];

let providerInstance = null;

const getProvider = () => {
  if (!providerInstance) {
    providerInstance = new ethers.JsonRpcProvider(RPC_URL);
  }
  return providerInstance;
};

/**
 * Retrieves the existing wallet from localStorage, or creates a new one,
 * stores it, and requests funding.
 * @returns {Promise<string>} The wallet address.
 */
export const getOrSetupWallet = async () => {
  const storedPrivateKey = localStorage.getItem(KEYSTORE_STORAGE_KEY);

  if (storedPrivateKey) {
    try {
      const wallet = new ethers.Wallet(storedPrivateKey);
      localStorage.setItem(ADDRESS_STORAGE_KEY, wallet.address);
      return wallet.address;
    } catch {
      console.warn('Failed to load stored wallet. Creating a new one.');
    }
  }

  // Create new wallet
  const wallet = ethers.Wallet.createRandom();
  console.log('New wallet created with address:', wallet.address);
  
  // Store locally
  localStorage.setItem(KEYSTORE_STORAGE_KEY, wallet.privateKey);
  localStorage.setItem(ADDRESS_STORAGE_KEY, wallet.address);
  
  const address = wallet.address;

  // Request funding for the new wallet
  try {
    const response = await fetch(`${import.meta.env.VITE_PROD_SERVER}/fund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address })
    });
    
    if (!response.ok) {
      console.error('Funding request failed', await response.text());
    } else {
      const data = await response.json();
      console.log('Wallet funded successfully:', data);
    }
  } catch (error) {
    console.error('Error calling funding endpoint:', error);
  }

  return address;
};

/**
 * Executes an ERC20 transfer using the local custodial wallet.
 * @param {string} toAddress - The destination address for the payment.
 * @param {string} amount - The amount to send (in readable units, e.g., '100').
 * @returns {Promise<string>} The transaction hash.
 */
export const payWithWallet = async (toAddress, amount) => {
  let storedPrivateKey = localStorage.getItem(KEYSTORE_STORAGE_KEY);
  if (!storedPrivateKey) {
    console.log('No wallet found, setting one up...');
    await getOrSetupWallet();
    storedPrivateKey = localStorage.getItem(KEYSTORE_STORAGE_KEY);
    if (!storedPrivateKey) {
      throw new Error('No wallet found. Please setup a wallet first.');
    }
  }

  // Load the wallet
  const wallet = new ethers.Wallet(storedPrivateKey);
  const connectedWallet = wallet.connect(getProvider());

  // Instantiate the contract
  const contract = new ethers.Contract(ERC20_ADDRESS, ERC20_ABI, connectedWallet);

  // We need decimals to correctly parse the amount
  // If the token is a standard 18 decimals, we can assume it or fetch it.
  // Fetching it dynamically is safer.
  const decimals = await contract.decimals();
  const parsedAmount = ethers.parseUnits(amount.toString(), decimals);

  // Execute transfer
  const tx = await contract.transfer(toAddress, parsedAmount);
  
  // Wait for confirmation
  const receipt = await tx.wait();
  
  return receipt.hash;
};
