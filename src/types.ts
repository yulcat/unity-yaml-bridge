/**
 * Internal AST representation of a Unity YAML file.
 * This is the intermediate format between Unity YAML and compact .ubridge.
 */

/** Unity object reference */
export interface FileReference {
  fileID: string;
  guid?: string;
  type?: number;
}

/** A single Unity YAML document (one --- block) */
export interface UnityDocument {
  /** Unity type ID (e.g. 1=GameObject, 4=Transform, 114=MonoBehaviour) */
  typeId: number;
  /** The tag name (e.g. "GameObject", "Transform", "MonoBehaviour") */
  typeName: string;
  /** File-local ID (&anchor) */
  fileId: string;
  /** Whether this is a stripped object */
  stripped: boolean;
  /** The parsed YAML properties as a nested key-value structure */
  properties: Record<string, any>;
}

/** Represents a GameObject in the hierarchy */
export interface GameObjectNode {
  /** Display name from m_Name */
  name: string;
  /** File-local ID of this GameObject document */
  fileId: string;
  /** Components attached to this GO (excluding Transform/RectTransform) */
  components: ComponentInfo[];
  /** Transform/RectTransform info */
  transform: TransformInfo;
  /** Child GameObjects */
  children: GameObjectNode[];
  /** If this GO came from a nested prefab instance */
  nestedPrefab?: {
    instanceId: string;
    sourceGuid: string;
    sourceName?: string;
  };
  /** Layer */
  layer: number;
  /** Is active */
  isActive: boolean;
}

/** Component info attached to a GameObject */
export interface ComponentInfo {
  /** Component type name (e.g. "Image", "Animator", "MonoBehaviour") */
  typeName: string;
  /** The Unity type ID */
  typeId: number;
  /** File-local ID */
  fileId: string;
  /** The script GUID for MonoBehaviour components */
  scriptGuid?: string;
  /** Resolved script name (if known) */
  scriptName?: string;
  /** All properties (excluding boilerplate) */
  properties: Record<string, any>;
  /** Whether this component is stripped */
  stripped: boolean;
}

/** Transform data */
export interface TransformInfo {
  /** File-local ID of the transform document */
  fileId: string;
  /** Is this a RectTransform? */
  isRect: boolean;
  /** All transform properties */
  properties: Record<string, any>;
}

/** A PrefabInstance document */
export interface PrefabInstanceInfo {
  /** File-local ID of the PrefabInstance */
  fileId: string;
  /** Source prefab reference */
  sourcePrefab: FileReference;
  /** Parent transform */
  transformParent: FileReference;
  /** Property modifications */
  modifications: PropertyModification[];
  /** Removed components */
  removedComponents: FileReference[];
}

/** A single property modification in a PrefabInstance */
export interface PropertyModification {
  /** Target object reference */
  target: FileReference;
  /** Dot-separated property path */
  propertyPath: string;
  /** String value */
  value: string;
  /** Object reference value (for reference-type overrides) */
  objectReference: FileReference;
}

/** The complete parsed representation of a Unity YAML file */
export interface UnityFile {
  /** File type */
  type: 'prefab' | 'variant' | 'scene';
  /** Raw documents */
  documents: UnityDocument[];
  /** Reconstructed GameObject hierarchy (null for pure variants) */
  hierarchy?: GameObjectNode;
  /** PrefabInstance documents */
  prefabInstances: PrefabInstanceInfo[];
  /** For variants: the source prefab info */
  variantSource?: FileReference;
}

/** Unity type ID to name mapping */
export const UNITY_TYPE_MAP: Record<number, string> = {
  1: 'GameObject',
  4: 'Transform',
  20: 'Camera',
  23: 'MeshRenderer',
  29: 'OcclusionCullingSettings',
  33: 'MeshFilter',
  54: 'Rigidbody',
  64: 'MeshCollider',
  65: 'BoxCollider',
  82: 'AudioSource',
  95: 'Animator',
  104: 'RenderSettings',
  108: 'Light',
  114: 'MonoBehaviour',
  120: 'LineRenderer',
  135: 'SphereCollider',
  136: 'CapsuleCollider',
  137: 'SkinnedMeshRenderer',
  157: 'LightmapSettings',
  195: 'NavMeshAgent',
  196: 'NavMeshSettings',
  198: 'ParticleSystem',
  199: 'ParticleSystemRenderer',
  205: 'LODGroup',
  212: 'Sprite',
  220: 'LightProbeGroup',
  222: 'CanvasRenderer',
  223: 'Canvas',
  224: 'RectTransform',
  225: 'CanvasGroup',
  226: 'CanvasScaler',
  1001: 'PrefabInstance',
};

/** Fields to omit from compact output (boilerplate) */
export const OMIT_FIELDS = new Set([
  'm_ObjectHideFlags',
  'm_CorrespondingSourceObject',
  'm_PrefabInstance',
  'm_PrefabAsset',
  'm_PrefabInternal',
  'm_PrefabParentObject',
  'serializedVersion',
  'm_EditorHideFlags',
  'm_EditorClassIdentifier',
  'm_Script',
  'm_Name',
  'm_GameObject',
  'm_Father',
  'm_Children',
  'm_RootOrder',
  'm_Component',
  'm_TagString',
  'm_Icon',
  'm_NavMeshLayer',
  'm_StaticEditorFlags',
]);

/** Components to omit from the structure tree (boilerplate) */
export const OMIT_COMPONENTS = new Set([
  'Transform',
  'RectTransform',
  'CanvasRenderer',
]);
