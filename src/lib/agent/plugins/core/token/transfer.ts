import { Account, BigNumberish, uint256 } from 'starknet';
import { tokenAddresses } from './constants/erc20';
import { StarknetAgentInterface } from 'src/lib/agent/tools/tools';
import { AddAgentLimit, Limit } from 'src/lib/agent/limit';
import { Token } from 'src/lib/agent/limit';

export interface transferPayloads {
  recipient_address: string;
  amount: string;
  symbol: string;
}

interface TransferResult {
  status: 'success' | 'failure';
  amount?: string;
  symbol?: string;
  recipients_address?: string;
  transaction_hash?: string;
  error?: string;
  step?: string;
}

// Constants
const DECIMALS = {
  USDC: 6,
  USDT: 6,
  DEFAULT: 18,
};

/**
 * Formats amount to the correct decimal places for the token
 * @payload amount The amount as a string (e.g., "0.0001")
 * @payload decimals Number of decimal places
 * @returns Formatted amount as a string
 */
const formatTokenAmount = (amount: string, decimals: number): string => {
  const [whole, fraction = ''] = amount.split('.');
  const paddedFraction = fraction.padEnd(decimals, '0');
  return whole + paddedFraction;
};

const handleLimitTokenTransfer = (
  amount: BigNumberish,
  symbol: string,
  limit: Token[]
) => {
  const index = limit.findIndex(
    (token) => token.symbol.toUpperCase() === symbol.toUpperCase()
  );
  if (index === -1) {
    console.log(`Not limit find for token : ${symbol}`);
    return;
  }

  const decimals =
    DECIMALS[limit[index].symbol as keyof typeof DECIMALS] || DECIMALS.DEFAULT;
  const formattedAmount = formatTokenAmount(limit[index].amount, decimals);
  const amountUint256 = uint256.bnToUint256(formattedAmount);
  if (BigInt(amount) > BigInt(amountUint256.low)) {
    throw new Error(
      `Error your limit token exceed the transaction amount.\n Transaction amount : ${amount} \n Transacion limit amount ${limit[index].amount}`
    );
  }
  console.log('Limit Token : ', amountUint256.low, amount);
};

/**
 * Transfers ERC20 tokens on Starknet
 * @payload agent The agent performing the transfer
 * @payload payloads transfer payloadeters including recipient, amount, and token symbol
 * @returns Result of the transfer operation
 */
export const transfer = async (
  agent: StarknetAgentInterface,
  payloads: transferPayloads
): Promise<string> => {
  try {
    const credentials = agent.getAccountCredentials();
    const provider = agent.getProvider();

    const account = new Account(
      provider,
      credentials.accountPublicKey,
      credentials.accountPrivateKey
    );

    const limit = agent.getLimit();

    if (limit.transfer_limit) {
      console.log(
        `Welcome to transfer limit interface your limit is set to : \n ${limit.transfer_limit[0].symbol} amount ${limit.transfer_limit[0].amount}`
      );
    }
    const tokenAddress = tokenAddresses[payloads.symbol];
    if (!tokenAddress) {
      throw new Error(`Token ${payloads.symbol} not supported`);
    }

    const decimals =
      DECIMALS[payloads.symbol as keyof typeof DECIMALS] || DECIMALS.DEFAULT;
    const formattedAmount = formatTokenAmount(payloads.amount, decimals);
    const amountUint256 = uint256.bnToUint256(formattedAmount);
    if (Array.isArray(limit.transfer_limit)) {
      handleLimitTokenTransfer(
        amountUint256.low,
        payloads.symbol,
        limit.transfer_limit
      );
    }
    const result = await account.execute({
      contractAddress: tokenAddress,
      entrypoint: 'transfer',
      calldata: [
        payloads.recipient_address,
        amountUint256.low,
        amountUint256.high,
      ],
    });

    console.log(
      'transfer initiated. Transaction hash:',
      result.transaction_hash
    );

    await provider.waitForTransaction(result.transaction_hash);

    const transferResult: TransferResult = {
      status: 'success',
      amount: payloads.amount,
      symbol: payloads.symbol,
      recipients_address: payloads.recipient_address,
      transaction_hash: result.transaction_hash,
    };

    return JSON.stringify(transferResult);
  } catch (error) {
    console.error('transfer failed:', error);

    const transferResult: TransferResult = {
      status: 'failure',
      error: error instanceof Error ? error.message : 'Unknown error',
      step: 'transfer execution',
    };

    const result = JSON.stringify(transferResult);
    return result;
  }
};

export type TransferPlayloadSchema = {
  symbol: string;
  recipient_address: string;
  amount: string;
};

export const transfer_signature = async (input: {
  payloads: TransferPlayloadSchema[];
}): Promise<any> => {
  try {
    const payloads = input.payloads;

    if (!Array.isArray(payloads)) {
      throw new Error('Payloads is not an Array');
    }

    const limit = AddAgentLimit();

    const results = await Promise.all(
      payloads.map(async (payload) => {
        const tokenAddress = tokenAddresses[payload.symbol];
        if (!tokenAddress) {
          return {
            status: 'error',
            error: {
              code: 'TOKEN_NOT_SUPPORTED',
              message: `Token ${payload.symbol} not supported`,
            },
          };
        }
        const decimals =
          DECIMALS[payload.symbol as keyof typeof DECIMALS] || DECIMALS.DEFAULT;
        const formattedAmount = formatTokenAmount(payload.amount, decimals);
        const amountUint256 = uint256.bnToUint256(formattedAmount);
        if (Array.isArray(limit.transfer_limit)) {
          handleLimitTokenTransfer(
            amountUint256.low,
            payload.symbol,
            limit.transfer_limit
          );
        }

        return {
          status: 'success',
          transactions: {
            contractAddress: tokenAddress,
            entrypoint: 'transfer',
            calldata: [
              payload.recipient_address,
              amountUint256.low,
              amountUint256.high,
            ],
          },
        };
      })
    );
    console.log('Results :', results);
    return JSON.stringify({ transaction_type: 'INVOKE', results });
  } catch (error) {
    console.error('Transfer call data failure:', error);
    return {
      status: 'error',
      error: {
        code: 'TRANSFER_CALL_DATA_ERROR',
        message: error.message || 'Failed to generate transfer call data',
      },
    };
  }
};
