/* Shapes shared by the storage drivers. */
export interface ObjectInfo {
  contentLength: number;
  contentType: string;
  etag: string | null;
}

export interface ByteRange {
  start: number;
  end: number;
}

export interface StoredObject {
  key: string;
  lastModified: Date | null;
}

export interface ObjectStore {
  statObject(key: string): Promise<ObjectInfo | null>;
  openObjectStream(key: string, range?: ByteRange): Promise<NodeJS.ReadableStream | null>;
  listObjects(prefix: string): Promise<StoredObject[]>;
  deleteObjectKeys(keys: string[]): Promise<number>;
}
