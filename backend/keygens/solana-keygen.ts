import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
const keypair = Keypair.generate();

console.log(
  `✅ Finished! Our secret key in base58 is: ${bs58.encode(keypair.secretKey)}`
);
