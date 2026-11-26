/** Typed surface of the vendored aws4fetch (dist file ships none). */
export declare class AwsClient {
  constructor(options: { accessKeyId: string; secretAccessKey: string });
  sign(input: Request | URL | string, options?: { aws?: { signQuery?: boolean } }): Promise<Response>;
}
