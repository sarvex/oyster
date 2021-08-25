import { PublicKey } from '@solana/web3.js';
import * as bs58 from 'bs58';
import { deserializeBorsh, ParsedAccount } from '@oyster/common';
import { GOVERNANCE_SCHEMA } from './serialisation';
import {
  GovernanceAccount,
  GovernanceAccountClass,
  GovernanceAccountType,
  Realm,
} from './accounts';

import { MemcmpFilter, RpcContext } from './core/api';

export async function getRealms(rpcContext: RpcContext) {
  return getGovernanceAccountsImpl<Realm>(
    rpcContext.programId,
    rpcContext.endpoint,
    Realm,
    GovernanceAccountType.Realm,
  );
}

export async function getGovernanceAccounts<TAccount extends GovernanceAccount>(
  programId: PublicKey,
  endpoint: string,
  accountClass: GovernanceAccountClass,
  accountTypes: GovernanceAccountType[],
  filters: MemcmpFilter[] = [],
) {
  if (accountTypes.length === 1) {
    return getGovernanceAccountsImpl<TAccount>(
      programId,
      endpoint,
      accountClass,
      accountTypes[0],
      filters,
    );
  }

  const all = await Promise.all(
    accountTypes.map(at =>
      getGovernanceAccountsImpl<TAccount>(
        programId,
        endpoint,
        accountClass,
        at,
        filters,
      ),
    ),
  );

  return all.reduce((res, r) => ({ ...res, ...r }), {}) as Record<
    string,
    ParsedAccount<TAccount>
  >;
}

async function getGovernanceAccountsImpl<TAccount extends GovernanceAccount>(
  programId: PublicKey,
  endpoint: string,
  accountClass: GovernanceAccountClass,
  accountType: GovernanceAccountType,
  filters: MemcmpFilter[] = [],
) {
  let getProgramAccounts = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getProgramAccounts',
      params: [
        programId.toBase58(),
        {
          commitment: 'single',
          encoding: 'base64',
          filters: [
            {
              memcmp: {
                offset: 0,
                bytes: bs58.encode([accountType]),
              },
            },
            ...filters.map(f => ({
              memcmp: { offset: f.offset, bytes: bs58.encode(f.bytes) },
            })),
          ],
        },
      ],
    }),
  });
  const rawAccounts = (await getProgramAccounts.json())['result'];
  let accounts: Record<string, ParsedAccount<TAccount>> = {};

  for (let rawAccount of rawAccounts) {
    try {
      const account = {
        pubkey: new PublicKey(rawAccount.pubkey),
        account: {
          ...rawAccount.account,
          data: [], // There is no need to keep the raw data around once we deserialize it into TAccount
        },
        info: deserializeBorsh(
          GOVERNANCE_SCHEMA,
          accountClass,
          Buffer.from(rawAccount.account.data[0], 'base64'),
        ),
      };

      accounts[account.pubkey.toBase58()] = account;
    } catch (ex) {
      console.error(`Can't deserialize ${accountClass}`, ex);
    }
  }

  return accounts;
}
