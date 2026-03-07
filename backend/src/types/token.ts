export type TokenType = 'NATIVE' | 'ERC20' | 'ICRC1';

export interface TokenDescriptor {
  tokenType: TokenType;
  tokenSymbol: string;
  tokenDecimals: number;
  tokenAddress?: string;
}
