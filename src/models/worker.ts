import { ClientOpts } from 'redis';
import RedisClient from './redis';
import * as Types from '../common/types';
import * as Error from '../common/error';

export default class Worker {
  private redisClient: RedisClient;

  private listenMethodList: Types.workerListenMethod;

  constructor(options?: ClientOpts) {
    this.redisClient = new RedisClient(options);
  }

  public async getClusterInfo(clusterName: string) {
    const infoKey = `worker:info:${clusterName}`;
    const result = await this.redisClient.get(infoKey);

    result.endpointConfig = JSON.parse(result.endpointConfig);
    result.nodePool = JSON.parse(result.nodePool);
    return result;
  }

  public async listenClusterInfo(clusterName: string, callback: Function) {
    const infoKey = `worker:info:${clusterName}`;
    this.redisClient.on(infoKey, (err, key, value) => {
      if (!err) {
        // key -> worker:info:${clusterName}
        const parseValue = value;
        if (value.endpointConfig) {
          parseValue.endpointConfig = JSON.parse(value.endpointConfig);
        }
        if (value.nodePool) {
          parseValue.endpointConfig = JSON.parse(value.nodePool);
        }
        callback(key, parseValue);
      }
    });
  }

  public async writePayload(payload: object, dbpath: string) {
    await this.redisClient.set(dbpath, payload);
  }

  public listenReqeust(clusterName: string, methods: Types.workerListenMethod) {
    const pattern = `worker:request_queue:${clusterName}:*`;
    this.listenMethodList = methods;
    this.redisClient.on(pattern, async (err, key, value) => {
      const requestId = key?.split(':')[3];
      const resPath = `worker:response:${clusterName}:${requestId}`;
      const { type, payload } = value;
      if (err) {
        await this.writePayload({
          statusCode: Error.STATUS_CODE.unexpected,
          errMessage: err,
        }, resPath);
      } else if (type && this.listenMethodList[type]) {
        // parse stringified payload
        const res = await this.listenMethodList[type](JSON.parse(payload));
        await this.writePayload({
          statusCode: Error.STATUS_CODE.success,
          result: JSON.stringify(res),
        }, resPath);
      } else {
        await this.writePayload({
          statusCode: Error.STATUS_CODE.invalidParams,
          errMessage: 'invalid type',
        }, resPath);
      }
    });
    return null;
  }

  public async registerCluster(option: Types.ClusterRegisterParams) {
    // TODO: need stringify for endpointConfig, nodePool?
    await this.writePayload(option, `worker:info:${option.clusterName}`);
  }

  public async updateClusterInfo(clusterName: string, allowAdress?: string[], price?: number) {
    await this.writePayload({
      allowAdress,
      price,
    }, `worker:info:${clusterName}`);
  }
}
