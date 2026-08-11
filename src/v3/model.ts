import { UnityDocument } from '../types';

export type V3EntityKind = 'gameObject' | 'transform' | 'component';

export interface V3IdentityRecord {
  machineId: string;
  kind: V3EntityKind;
  fileId?: string;
  typeId: number;
  typeName: string;
  displayName?: string;
  ownerId?: string;
  scriptGuid?: string;
  scriptFileId?: string;
  scriptType?: number;
}

export interface V3StructureComponent {
  typeName: string;
  machineId: string;
}

export interface V3StructureNode {
  name: string;
  machineId: string;
  components: V3StructureComponent[];
  children: V3StructureNode[];
}

export interface V3Document {
  version: 3;
  kind: 'prefab';
  profile: string;
  assetGuid?: string;
  structure: V3StructureNode;
  details: Map<string, Record<string, unknown>>;
  identity: Map<string, V3IdentityRecord>;
}

export interface V3WriterOptions {
  profile?: string;
  assetGuid?: string;
}

export interface V3CompileResult {
  documents: UnityDocument[];
}
