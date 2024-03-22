/* eslint-disable @typescript-eslint/naming-convention */

import type {TAddress} from './address';

/*******************************************************************************
 ** Maybe types are used to represent optional values
 ******************************************************************************/
export type Maybe<T> = T | undefined;

/*******************************************************************************
 ** Dict types are used to represent objects with string/number keys
 ******************************************************************************/
export type TDict<T> = {[key: string]: T};
export type Dict<T> = TDict<T>;
export type TNDict<T> = {[key: number]: T};
export type NDict<T> = TNDict<T>;

/*******************************************************************************
 ** VoidPromiseFunction is used to represent a function that returns a Promise<void>
 ******************************************************************************/
export type VoidPromiseFunction = () => Promise<void>;

/*******************************************************************************
 ** A proper way to use the bigint conversion
 ******************************************************************************/
export type TNumberish = bigint | number | string | `${number}`; //wagmi weird type
export type TNormalizedBN = {raw: bigint; normalized: number; display: string};

/*******************************************************************************
 ** A classic ERC20 token & the one wrapped by chainID
 ******************************************************************************/
export type TToken = {
	address: TAddress;
	name: string;
	symbol: string;
	decimals: number;
	chainID: number;
	logoURI?: string;
	value: number;
	balance: TNormalizedBN;
};
export type TChainTokens = TNDict<TDict<TToken>>;

/*******************************************************************************
 ** A classic Sort direction element
 ******************************************************************************/
export type TSortDirection = 'asc' | 'desc' | '';

/*******************************************************************************
 ** Default status to mimic wagmi hooks.
 ******************************************************************************/
export type TDefaultStatus = {
	isFetching: boolean;
	isFetched: boolean;
	isRefetching: boolean;
	isLoading: boolean;
	isSuccess: boolean;
	isError: boolean;
};

/*******************************************************************************
 ** Request, Response and helpers for the useBalance hook.
 ******************************************************************************/
export type TBalanceData = {
	decimals: number;
	symbol: string;
	name: string;
	raw: bigint;
	normalized: number;
	//Optional
	rawPrice?: bigint;
	normalizedPrice?: number;
	normalizedValue?: number;
	force?: boolean;
};

/*******************************************************************************
 ** Classic tokenlist structure
 ******************************************************************************/
export type TTokenList = {
	name: string;
	description: string;
	timestamp: string;
	logoURI: string;
	uri: string;
	keywords: string[];
	version: {
		major: number;
		minor: number;
		patch: number;
	};
	tokens: {
		address: TAddress;
		name: string;
		symbol: string;
		decimals: number;
		chainId: number;
		logoURI?: string;
	}[];
};
