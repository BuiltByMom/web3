import {erc20Abi, isAddressEqual} from 'viem';
import {readContract, sendTransaction, waitForTransactionReceipt} from '@wagmi/core';

import {MAX_UINT_256} from '../../utils/constants';
import {usdtAbi, usdtAddress} from '../abi/usdt.abi';
import {assertAddress} from '../assert';
import {toAddress} from '../tools.address';
import {retrieveConfig} from './config';
import {handleTx, toWagmiProvider} from './provider';
import {defaultTxStatus, type TTxResponse} from './transaction';

import type {Abi, BaseError} from 'viem';
import type {Connector} from 'wagmi';
import type {TAddress} from '../../types/address';
import type {TWriteTransaction} from './provider';

function getChainID(chainID: number): number {
	if (typeof window !== 'undefined' && (window as any)?.ethereum?.useForknetForMainnet) {
		if (chainID === 1) {
			return 1337;
		}
	}
	return chainID;
}

//Because USDT do not return a boolean on approve, we need to use this ABI
const ALTERNATE_ERC20_APPROVE_ABI = [
	{
		constant: false,
		inputs: [
			{name: '_spender', type: 'address'},
			{name: '_value', type: 'uint256'}
		],
		name: 'approve',
		outputs: [],
		payable: false,
		stateMutability: 'nonpayable',
		type: 'function'
	}
] as const;

/*******************************************************************************
 ** isApprovedERC20 is a _VIEW_ function that checks if a token is approved for
 ** a spender.
 ******************************************************************************/
export async function isApprovedERC20(
	connector: Connector | undefined,
	chainID: number,
	tokenAddress: TAddress,
	spender: TAddress,
	amount = MAX_UINT_256
): Promise<boolean> {
	const wagmiProvider = await toWagmiProvider(connector as Connector);
	const result = await readContract(retrieveConfig(), {
		...wagmiProvider,
		abi: erc20Abi,
		chainId: getChainID(chainID),
		address: tokenAddress,
		functionName: 'allowance',
		args: [wagmiProvider.address, spender]
	});
	return (result || 0n) >= amount;
}

/*******************************************************************************
 ** allowanceOf is a _VIEW_ function that returns the amount of a token that is
 ** approved for a spender.
 ******************************************************************************/
type TAllowanceOf = {
	connector: Connector | undefined;
	chainID: number;
	tokenAddress: TAddress;
	spenderAddress: TAddress;
};
export async function allowanceOf(props: TAllowanceOf): Promise<bigint> {
	const wagmiProvider = await toWagmiProvider(props.connector);
	const result = await readContract(retrieveConfig(), {
		...wagmiProvider,
		chainId: getChainID(props.chainID),
		abi: erc20Abi,
		address: props.tokenAddress,
		functionName: 'allowance',
		args: [wagmiProvider.address, props.spenderAddress]
	});
	return result || 0n;
}

/*******************************************************************************
 ** approveERC20 is a _WRITE_ function that approves a token for a spender.
 **
 ** @param spenderAddress - The address of the spender.
 ** @param amount - The amount of collateral to deposit.
 ******************************************************************************/
type TApproveERC20 = TWriteTransaction & {
	spenderAddress: TAddress | undefined;
	amount: bigint;
};
export async function approveERC20(props: TApproveERC20): Promise<TTxResponse> {
	assertAddress(props.spenderAddress, 'spenderAddress');
	assertAddress(props.contractAddress);

	props.onTrySomethingElse = async (): Promise<TTxResponse> => {
		assertAddress(props.spenderAddress, 'spenderAddress');
		return await handleTx(props, {
			address: toAddress(props.contractAddress),
			abi: ALTERNATE_ERC20_APPROVE_ABI,
			functionName: 'approve',
			args: [props.spenderAddress, props.amount]
		});
	};

	return await handleTx(props, {
		address: props.contractAddress,
		abi: erc20Abi,
		functionName: 'approve',
		args: [props.spenderAddress, props.amount]
	});
}

/*******************************************************************************
 ** transferERC20 is a _WRITE_ function that transfers a token to a recipient.
 **
 ** @param spenderAddress - The address of the spender.
 ** @param amount - The amount of collateral to deposit.
 ******************************************************************************/
type TTransferERC20 = TWriteTransaction & {
	receiverAddress: TAddress | undefined;
	amount: bigint;
};

export async function transferERC20(props: TTransferERC20): Promise<TTxResponse> {
	assertAddress(props.receiverAddress, 'receiverAddress');
	assertAddress(props.contractAddress);

	return await handleTx(props, {
		address: toAddress(props.contractAddress),
		abi: isAddressEqual(props.contractAddress, usdtAddress) ? (usdtAbi as Abi) : erc20Abi,
		functionName: 'transfer',
		args: [props.receiverAddress, props.amount]
	});
}

/***************************************************************
 ** transferEther is a _WRITE_ function that transfers ETH to a recipient.
 ** Here, ETH represents the chain's native coin.
 **
 ** @param spenderAddress - The address of the spender.
 ** @param amount - The amount of collateral to deposit.
 ******************************************************************************/
type TTransferEther = Omit<TWriteTransaction, 'contractAddress'> & {
	receiverAddress: TAddress | undefined;
	amount: bigint;
	shouldAdjustForGas?: boolean;
};

export async function transferEther(props: TTransferEther): Promise<TTxResponse> {
	assertAddress(props.receiverAddress, 'receiverAddress');

	props.statusHandler?.({...defaultTxStatus, pending: true});
	const wagmiProvider = await toWagmiProvider(props.connector);

	assertAddress(wagmiProvider.address, 'userAddress');
	try {
		const hash = await sendTransaction(retrieveConfig(), {
			...wagmiProvider,
			to: props.receiverAddress,
			value: props.amount
		});
		const receipt = await waitForTransactionReceipt(retrieveConfig(), {chainId: wagmiProvider.chainId, hash});
		if (receipt.status === 'success') {
			props.statusHandler?.({...defaultTxStatus, success: true});
		} else if (receipt.status === 'reverted') {
			props.statusHandler?.({...defaultTxStatus, error: true});
		}
		return {isSuccessful: receipt.status === 'success', receipt};
	} catch (error) {
		console.error(error);
		const errorAsBaseError = error as BaseError;
		props.statusHandler?.({...defaultTxStatus, error: true});
		return {isSuccessful: false, error: errorAsBaseError || ''};
	} finally {
		setTimeout((): void => {
			props.statusHandler?.({...defaultTxStatus});
		}, 3000);
	}
}
