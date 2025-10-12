export type TokenType = 'NATIVE' | 'ERC20';

export interface TokenDescriptor {
  tokenType: TokenType;
  tokenSymbol: string;
  tokenDecimals: number;
  tokenAddress?: `0x${string}`;
}
