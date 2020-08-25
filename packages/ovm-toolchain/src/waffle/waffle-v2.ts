/* External Imports */
import { providers, Wallet } from 'ethers-v4'
import { defaultAccounts } from 'ethereum-waffle-v2'
import Ganache from 'ganache-core'

/* Internal Imports */
import { ganache } from '../ganache'

/**
 * WaffleV2 MockProvider wrapper.
 */
export class MockProvider extends providers.Web3Provider {
  constructor(private options?: Ganache.IProviderOptions) {
    super(
      ganache.provider({
        gasPrice: 0,
        accounts: defaultAccounts,
        ...options,
      }) as any
    )
  }

  /**
   * Retrieves the wallet objects passed to this provider.
   * @returns List of wallet objects.
   */
  public getWallets(): Wallet[] {
    const items = this.options?.accounts ?? defaultAccounts
    return items.map((x: any) => new Wallet(x.secretKey, this))
  }

  /**
   * Sends an RPC call. Function is named "rpc" instead of "send" because
   * ethers will try to use the function if it's named "send".
   * @param method Ethereum RPC method to call.
   * @param params Params to the RPC method.
   * @returns Result of the RPC call.
   */
  public async rpc(method: string, params: any[] = []): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      this._web3Provider.sendAsync(
        {
          jsonrpc: '2.0',
          method,
          params,
        },
        (err: any, res: any) => {
          if (err) {
            reject(err)
          } else {
            resolve(res.result)
          }
        }
      )
    })
  }
}

export const waffleV2 = {
  MockProvider,
}
