import type {TAddress} from './address';

export type TInitSolverArgs = {
	chainID: number;
	from: TAddress;
	inputToken: TAddress;
	outputToken: TAddress;
	inputAmount: bigint;
	isDepositing: boolean;
	migrator?: TAddress;
	stakingPoolAddress?: TAddress; //Address of the staking pool, for veYFI zap in
};
