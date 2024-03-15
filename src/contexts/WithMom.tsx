import {useMemo} from 'react';
import {WagmiProvider} from 'wagmi';
import {RainbowKitProvider} from '@rainbow-me/rainbowkit';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';

import {getConfig} from '../utils/wagmi/config';
import {Web3ContextApp} from './useWeb3';
import {WithTokenList} from './WithTokenList';

import type {ReactElement} from 'react';
import type {Chain} from 'viem';
import type {Config} from 'wagmi';

type TWithMom = {
	children: ReactElement;
	supportedChains: Chain[];
	tokenLists?: string[];
};

function WithMom({children, supportedChains, tokenLists}: TWithMom): ReactElement {
	const queryClient = useMemo(() => new QueryClient(), []);
	const config = useMemo((): Config => getConfig({chains: supportedChains}), [supportedChains]);

	return (
		<WagmiProvider config={config}>
			<QueryClientProvider client={queryClient}>
				<RainbowKitProvider>
					<Web3ContextApp>
						<WithTokenList lists={tokenLists}>
							<>{children}</>
						</WithTokenList>
					</Web3ContextApp>
				</RainbowKitProvider>
			</QueryClientProvider>
		</WagmiProvider>
	);
}

export {WithMom};
