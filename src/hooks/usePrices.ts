import {z} from 'zod';

import {addressSchema, type TAddress, type TNormalizedBN, type TToken} from '../types';
import {toNormalizedBN, zeroNormalizedBN} from '../utils';
import {useFetch} from './useFetch';
import {useYDaemonBaseURI} from './useYDaemonBaseUri';

export const yDaemonPriceSchema = z.string();
export const yDaemonPricesSchema = z.record(addressSchema, yDaemonPriceSchema);

type TResponse = {[key: TAddress]: string};

type TResult = {[key: TAddress]: TNormalizedBN};

export const usePrices = ({
	tokens,
	chainId
}: {
	tokens: TToken[];
	chainId: number;
}): {data: TResult | undefined; isLoading: boolean; isSuccess: boolean} => {
	const {yDaemonBaseUri: yDaemonBaseUriWithoutChain} = useYDaemonBaseURI();

	const addressesString = tokens.map(token => token?.address).join(',');
	const url = tokens.length ? `${yDaemonBaseUriWithoutChain}/${chainId}/prices/some/${addressesString}` : null;
	const {data: rawData, isLoading, isSuccess} = useFetch<TResponse>({endpoint: url, schema: yDaemonPricesSchema});

	const data = rawData
		? tokens.reduce((acc, current) => {
				return {
					...acc,
					[current.address]: toNormalizedBN(rawData[current.address] || 0, 6) || zeroNormalizedBN
				};
			}, {})
		: undefined;
	return {data, isLoading, isSuccess};
};
