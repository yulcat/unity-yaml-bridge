"use strict";
/**
 * Internal AST representation of a Unity YAML file.
 * This is the intermediate format between Unity YAML and compact .ubridge.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OMIT_COMPONENTS = exports.OMIT_FIELDS = exports.UNITY_TYPE_MAP = void 0;
/** Unity type ID to name mapping */
exports.UNITY_TYPE_MAP = {
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
exports.OMIT_FIELDS = new Set([
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
exports.OMIT_COMPONENTS = new Set([
    'Transform',
    'RectTransform',
    'CanvasRenderer',
]);
//# sourceMappingURL=types.js.map