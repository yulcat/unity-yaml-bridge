import { UnityDocument } from '../types';
export declare const V3_STABLE_PROFILE: "unity-generic-v1";
export type V3StableProfile = typeof V3_STABLE_PROFILE;
export type V3EntityKind = 'gameObject' | 'transform' | 'component' | 'prefabInstance' | 'stripped' | 'owned';
export interface V3IdentityRecord {
    machineId: string;
    kind: V3EntityKind;
    origin?: 'inherited';
    fileId?: string;
    typeId: number;
    typeName: string;
    displayName?: string;
    ownerId?: string;
    prefabOwnerId?: string;
    scriptGuid?: string;
    scriptFileId?: string;
    scriptType?: number;
    stripped?: boolean;
    nestedRoot?: boolean;
    baselineParentId?: string;
    baselineOrder?: number;
    sourceGuid?: string;
    sourceFileId?: string;
    sourceFingerprint?: string;
    baselineDetails?: Record<string, unknown>;
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
    nestedSourceGuid?: string;
    prefabInstanceId?: string;
    tombstone?: boolean;
}
export interface V3Document {
    version: 3;
    kind: 'prefab' | 'variant';
    profile: V3StableProfile;
    assetGuid?: string;
    structure: V3StructureNode | null;
    variantRoots?: V3StructureNode[];
    variantRootId?: string;
    baseGuid?: string;
    details: Map<string, Record<string, unknown>>;
    identity: Map<string, V3IdentityRecord>;
}
export interface V3WriterOptions {
    profile?: V3StableProfile;
    assetGuid?: string;
    sourceResolver?: V3SourceResolver;
}
export interface V3SourceResolver {
    resolveFilePath(guid: string): string | undefined;
}
export interface V3CompileOptions {
    sourceResolver?: V3SourceResolver;
}
export interface V3CompileResult {
    documents: UnityDocument[];
}
//# sourceMappingURL=model.d.ts.map