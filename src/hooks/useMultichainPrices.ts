import {z} from 'zod';

import {type TAddress, type TDict, type TNDict, type TNormalizedBN} from '../types';
import {toAddress, toNormalizedBN, zeroNormalizedBN} from '../utils';
import {useFetch} from './useFetch';
import {yDaemonPricesSchema} from './usePrices';
import {useYDaemonBaseURI} from './useYDaemonBaseUri';

type TResponse = {[key: string]: {[key: TAddress]: string}};

type TResult = {[key: number]: {[key: TAddress]: TNormalizedBN}};

const yDaemonMultichainPriceSchema = z.record(z.string(), yDaemonPricesSchema);

export const useMultiChainPrices = ({
	tokens
}: {
	tokens: {address: TAddress; chainID: number}[];
}): {result: TResult | undefined; isLoading: boolean; isSuccess: boolean} => {
	const {yDaemonBaseUri: yDaemonBaseUriWithoutChain} = useYDaemonBaseURI();

	const queryString = tokens.map(token => `${token.chainID}:${token.address}`).join(',');
	const url = tokens.length ? `${yDaemonBaseUriWithoutChain}/prices/some/${queryString}` : null;
	const {
		data: rawData,
		isLoading,
		isSuccess
	} = useFetch<TResponse>({endpoint: url, schema: yDaemonMultichainPriceSchema});

	const result: TNDict<TDict<TNormalizedBN>> = {};

	for (const chainID in rawData) {
		result[+chainID] = {};
		for (const address in rawData[chainID]) {
			result[+chainID][address] =
				toNormalizedBN(rawData[chainID][toAddress(address)] || 0, 6) || zeroNormalizedBN;
		}
	}
	return {result, isLoading, isSuccess};
};
