import { Alchemy, Network } from "alchemy-sdk";

// In a real application, you would load these securely
// We use Vite's import.meta.env for environment variables.
const apiKey = import.meta.env.VITE_ALCHEMY_API_KEY;
const network = import.meta.env.VITE_ALCHEMY_NETWORK || "eth-mainnet";

let networkEnum = Network.ETH_MAINNET;
switch(network) {
    case 'polygon-mainnet':
        networkEnum = Network.MATIC_MAINNET;
        break;
    case 'base-mainnet':
        networkEnum = Network.BASE_MAINNET;
        break;
    case 'opt-mainnet':
        networkEnum = Network.OPT_MAINNET;
        break;
    case 'arb-mainnet':
        networkEnum = Network.ARB_MAINNET;
        break;
    // Add other networks as needed
}

const settings = {
  apiKey: apiKey,
  network: networkEnum,
};

const alchemy = new Alchemy(settings);

export const getNFTsForContract = async (contractAddress, pageKey = null) => {
  try {
      // If we don't have an API key configured yet, return mock data for demonstration
      if (!apiKey || apiKey === '') {
          console.warn("No Alchemy API key found, returning mock NFTs");
          return mockNFTs;
      }

      const response = await alchemy.nft.getNftsForContract(contractAddress, {
          pageKey: pageKey,
          omitMetadata: false,
      });
      return response.nfts;
  } catch (error) {
      console.error("Error fetching NFTs from Alchemy:", error);
      return [];
  }
};

const mockNFTs = [
    {
        contract: { address: "0x123..." },
        tokenId: "1",
        title: "Mock NFT 1",
        rawMetadata: { image: "https://picsum.photos/id/101/400/400" },
        media: [{ gateway: "https://picsum.photos/id/101/400/400" }]
    },
    {
        contract: { address: "0x123..." },
        tokenId: "2",
        title: "Mock NFT 2",
        rawMetadata: { image: "https://picsum.photos/id/102/400/400" },
        media: [{ gateway: "https://picsum.photos/id/102/400/400" }]
    },
    {
        contract: { address: "0x123..." },
        tokenId: "3",
        title: "Mock NFT 3",
        rawMetadata: { image: "https://picsum.photos/id/103/400/400" },
        media: [{ gateway: "https://picsum.photos/id/103/400/400" }]
    },
    {
        contract: { address: "0x123..." },
        tokenId: "4",
        title: "Mock NFT 4",
        rawMetadata: { image: "https://picsum.photos/id/104/400/400" },
        media: [{ gateway: "https://picsum.photos/id/104/400/400" }]
    },
    {
        contract: { address: "0x123..." },
        tokenId: "5",
        title: "Mock NFT 5",
        rawMetadata: { image: "https://picsum.photos/id/106/400/400" },
        media: [{ gateway: "https://picsum.photos/id/106/400/400" }]
    }
];
