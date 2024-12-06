/// <reference types="@novorender/webgl-api" />

declare module "@novorender/data-js-api" {
    import type { RenderSettings, CameraProperties, CameraControllerParams, ColorRGB, OrthoControllerParams, ColorRGBA, GeoLocation } from "@novorender/webgl-api";
    import type { MeasureSettings } from "@novorender/measure-api";
    import type { ReadonlyVec4, vec3 } from "gl-matrix";

    /** Integer index/handle for identifying a single object */
    export type ObjectId = number; // integer

    /** Read only array of integer indices/handles for identifying a set of objects */
    export type ObjectIdArray = ReadonlyArray<ObjectId>; // go for Uin32Array instead?

    /** Fixed size, read-only array type. */
    export type FixedSizeArray<N extends number, T> = N extends 0
        ? never[]
        : {
              0: T;
              length: N;
          } & ReadonlyArray<T>;

    /** Axis-aligned bounding box */
    export interface AABB {
        /** minimum coordinates */
        readonly min: ReadonlyVec3;
        /** maximum coordinates */
        readonly max: ReadonlyVec3;
    }

    /** Bounding sphere */
    export interface BoundingSphere {
        /** Sphere center. */
        readonly center: vec3;
        /** Sphere radius. */
        readonly radius: number;
    }

    /** Lightweight reference to a single object within a scene instance.
     * @remarks
     * Object metadata are not loaded with scene automatically and may require an additional server request. This interface contains only the identity required to perform such a request.
     */
    export interface ObjectReference {
        /** The id of the object */
        readonly id: ObjectId;

        /** The instance that contains this object. */
        // readonly instance: Instance;

        /** Load the associated object meta data. */
        loadMetaData(): Promise<ObjectData>;
    }

    /** Type of node */
    export const enum NodeType {
        /** Node has children. */
        Internal = 0,
        /** Node has no children. */
        Leaf = 1,
    }

    /** Hierarcical object reference to a single object within a scene instance.
     *
     * @remarks
     * This interface extends {@link ObjectReference} with data required for hierachical tree views and 3D rendering without loading the entire set of metadata.
     */
    export interface HierarcicalObjectReference extends ObjectReference {
        /** The path of the object expressed as a hierarchical filesystem-like path string. */
        readonly path: string;

        /** Type of node. */
        readonly type: NodeType;

        /** Bounding volume */
        readonly bounds?: {
            readonly box: AABB;
            readonly sphere: BoundingSphere;
        };
        readonly descendants?: ObjectId[];
    }

    /** Object metadata.
     */
    export interface ObjectData extends HierarcicalObjectReference {
        /** Name of object (typically a GUID from IFC database). */
        readonly name: string;

        /** Description of object (typically from IFC database). */
        readonly description?: string;

        /** Url associated with object */
        readonly url?: string;

        /** String dictionary of any additional metadata properties associated with object */
        properties: [key: string, value: string][];

        /** Save object meta data. */
        save(): Promise<boolean>;
    }

    /** Search pattern */
    export interface SearchPattern {
        /** Property name to find. */
        property?: string;
        /** Value to find.
         * if value is array of strings then search property value should match any ("or" function) of array values
         */
        value?: string | string[];
        /** Require exact match or not. */
        exact?: boolean;
        /** Exclude this match from result.
         * property name is mandatory
         */
        exclude?: boolean;
        /** Range of values to search.
         * property name is mandatory
         */
        range?: { min: string; max: string };
    }

    /** Search object options */
    export interface SearchOptions {
        /** Path to search start from.
         * @remarks
         * Path is similar to filesystem file/folder hierarchical paths, e.g. my_folder/my_object.
         * Paths reflect original CAD model hierarchy (.ifc, .rvm, etc).
         * Only objects contained within specified folder will be returned.
         */
        parentPath?: string;

        /** How many generations of descendants to include in search.
         * @remarks
         * 0 - object itself
         *
         * 1 - children only
         *
         * undefined - deepest levels.
         */
        descentDepth?: number;

        /** Property pattern to search for. */
        searchPattern?: SearchPattern[] | string;

        /** Preload all matching objects.
         * @remarks
         * This param should be set if you want to access some parameters of all results later to prevent per object data request.
         */
        full?: boolean;
    }

    /** Scene Access level */
    export const enum AccessType {
        /** Read only access */
        Read,
        /** Read/write access */
        ReadWrite
    }

    /** Scene objects group */
    export interface ObjectGroup {
        /** Object group uuid. */
        id: string;
        /** Object group name. */
        name: string;
        /** List of selected object id's.
         * @remarks
         * The array itself is immutable/readonly, so updates are done by assigning a new array.
         */
        ids?: ObjectIdArray;
        /** Group color when selected. */
        color?: ColorRGB | ColorRGBA;
        /** Group opacity when selected. */
        opacity?: number;
        /** Is group selected? */
        selected: boolean;
        /** Is Group hidden? */
        hidden: boolean;
        /** Group filling search criterias.
         * @remarks
         * This search criterias will be used to refill ids array on scene rebuilding automatically.
         * If search is not defined then ids array will remain on scene rebuilding.
        */
        search?: SearchPattern[];
        /** Include descendants.
         * @remarks
         * undefined value will be interpret as true
        */
        includeDescendants?: boolean;
        /** Grouping. */
        grouping?: string;
    }

    export namespace Bookmark {
        /** Objects group bookmark state */
        export interface ObjectGroup {
            /** Object group uuid. */
            id: string;
            /** Is group selected? */
            selected: boolean;
            /** Is Group hidden? */
            hidden: boolean;
            /** Object Ids array */
            ids?: ObjectIdArray;
        }

        /** Clipping planes settings.
        * @remarks
        * Clipping planes allows for an axis alligned box to define what volume will be rendered or not.
        * This is useful for rendering various cross sections and revealing internal geometry.
        */
        export interface ClippingPlanes {
            /** Whether to clip geometry by the actual bounding box or not. */
            enabled: boolean;
            /** Whether to clip geometry inside or outside the actual bounding box. */
            inside: boolean;
            /** Whether to show the actual bounding box or not. */
            showBox: boolean;
            /** The axis aligned bounding volume. */
            bounds: AABB;
        }

        /** Clipping volume settings.
        * @remarks
        * Clipping volume allows for a set of up to 6 planes to define a volume that excluded from rendering.
        * This is useful for rendering various cross sections and revealing internal geometry.
        */
        export interface ClippingVolume {
            /** Whether to clip geometry by the actual bounding box or not. */
            enabled: boolean;
            /** How multiple clipping planes are combined. Default: "union" */
            mode: "intersection" | "union";
            /** List of clipping planes (max 6), expressed as plane normal (x,y,z) and offset from origo (w) in a 4D world space vector. */
            planes: readonly ReadonlyVec4[];
        }

    }

    export interface MeasureObjectPoint {
        id: number;
        pos: vec3;
        settings?: MeasureSettings;
    }
    /** Bookmark, used to store camera parameters such as postion, rotation, fov etc. */
    export interface Bookmark {
        /** Bookmark name. */
        name: string;
        /** Bookmark id. */
        id?: string;
        /** Grouping. */
        grouping?: string;
        /** Bookmark description. */
        description?: string;
        /** Bookmark preview image as base64 encoded. */
        img?: string;
        /** Bookmark objects groups. */
        objectGroups?: Bookmark.ObjectGroup[];
        /** Bookmark camera position. */
        camera?: CameraProperties;
        /** Bookmark ortho camera. */
        ortho?: OrthoControllerParams;
        /** Show selection only in 3D */
        selectedOnly: boolean;
        /** Clipping planes */
        clippingPlanes?: Bookmark.ClippingPlanes;
        /** Clipping volume */
        clippingVolume?: Bookmark.ClippingVolume;
        /** Measurement points */
        measurement?: vec3[];
        /** Measurement objects points */
        objectMeasurement?: MeasureObjectPoint[];
        /** Selection basket */
        selectionBasket?: {
            ids: number[],
            mode: number,
        };
        /** Grid settings */
        grid?: RenderSettings["grid"];
        /** Follow path */
        followPath?: {
            id: number;
            profile: number;
            currentCenter?: vec3;
        };
        defaultVisibility?: "neutral" | "semiTransparent" | "transparent";
    }

    /** Lightweight scene preview object for viewing lists of scenes.
     * 
     */
    export interface ScenePreview {
        /** Scene Id
         * @remarks
         * For new scenes, this will contain a random string/guid.
         */
        id: string;

        /** Scene title */
        title: string;

        /** Last modification time */
        lastModified?: Date;

        /** Amount time scene was viewed
         * @remarks
         * Used for viewer scenes only
         */
        count?: number;
    }

    export interface ObjectDB {
        /** Get {@link ObjectData} by scene object id */
        getObjectMetdata(id: number): Promise<ObjectData>;

        /** Search for objects.
         * @param filter {@link SearchOptions} filtering options.
         * @param signal Abort request signal.
         * @remarks
         * See {@link Scene.search} for more details.
         * @returns Async iterator of {@link HierarcicalObjectReference}
         */
        search(filter: SearchOptions, signal: AbortSignal | undefined): AsyncIterableIterator<HierarcicalObjectReference>;
        descendants(object: HierarcicalObjectReference, signal: AbortSignal | undefined): Promise<ObjectId[]>;
    }

    export interface SceneData {
        url: string;
        title: string;
        db?: ObjectDB;
        settings?: RenderSettings;
        camera?: Required<CameraControllerParams>;
        viewerScenes?: ScenePreview[];
        /** List of bookmarks. */
        bookmarks?: Bookmark[];
        /** List of object groups with properties */
        objectGroups: ObjectGroup[];

        customProperties?: any;
        organization?: string;
        tmZone?: string;
    }

    export interface SceneLoadFail {
        error: string;
        tenant?: string;
    }

    export interface Resource {
        id: string;
        title: string;
        original: string;
        revision?: string;
        created: Date;
        path?: string;
        tags?: string[];
        type?: string;
        size?: number;
    }

    export interface ResourcePreview {
        /** Gltf preview url */
        gltf: string;
        /** Gltf bin preview url */
        bin: string;
    }

    export interface SceneDefinition {
        title: string;
        id: string;
        assets: {
            name?: string,
            resource: string,
            position?: {
                X: number,
                Y: number,
                Z: number
            },
            rotation?: {
                X: number,
                Y: number,
                Z: number,
                W: number
            },
            scale?: {
                X: number,
                Y: number,
                Z: number
            }
        }[];
    }

    export interface ActiveProcess {
        id: string;
        name: string;
        state: string;
    }

    export interface ProcessProgress {
        /** New progress text */
        text: string;
        /** True if process complete */
        complete: boolean;
        /** Last read progress text position. Should be used to next request */
        position: number;
    }

    // Represents all remote http calls to server. This object can also be a fake for unit testing etc.
    export interface API {
        /** Get information about currently authenticated user */
        getUserInformation(): Promise<{ name: string; organization: string; role: string | undefined; features: any; } | undefined>;

        /**
         * Get list of available scenes.
         * @remarks
         * The list contains only those scenes available to the currently authenticated user.
         * For anonymous users, only public scenes are available.
         */
        getScenes(): Promise<readonly ScenePreview[]>;

        loadScene(id: string): Promise<SceneData | SceneLoadFail>;
        putScene(scene: SceneData): Promise<boolean>;
        getBookmarks(id: string, options?: { group?: string, personal?: boolean }): Promise<Bookmark[]>;
        saveBookmarks(id: string, bookmarks: Bookmark[], options?: { group?: string, personal?: boolean }): Promise<boolean>;
        getGroupIds(sceneId: string, id: string): Promise<ObjectId[]>;

        /**
         * Get list of available resources.
         * @remarks
         * The list contains only those resources available to the currently authenticated user.
         * Only administrator could access to resources.
         */
        getResources(): Promise<Resource[]>;

        /**
         * Update the specified resource in cloud storage.
         * @remarks
         * Only administrator may update a resource.
         * @param resource The {@link Resource}
         * @returns A boolean promise indicating when the operation is complete succesfully/failed.
         * @throws Error in case of insufficient access rights.
         */
        updateResource(resource: Resource): Promise<boolean>;

        /**
         * Delete the specified resource from cloud storage.
         * @remarks
         * Only administrator may delete a resource.
         * @param id The resource id (guid)
         * @returns A boolean promise indicating when the operation is complete succesfully/failed.
         * @throws Error in case of insufficient access rights.
         */
        deleteResource(id: string): Promise<boolean>;

        /**
         * Get preview of the specified resource from cloud storage.
         * @remarks
         * Only administrator may access resources.
         * @param id The scene id (guid)
         * @returns Returns {@link ResourcePreview}
         * @throws Error in case of insufficient access rights.
         */
        getResource(id: string): Promise<ResourcePreview>;

        /**
         * Delete the specified scene from cloud storage.
         * @remarks
         * Only scene owners may delete a scene.
         * The scene will be permanently lost and any references to it becomes invalid.
         * @param id The scene id (guid)
         * @returns A boolean promise indicating when the operation is complete succesfully/failed.
         * @throws Error in case of insufficient access rights.
         */
        deleteScene(id: string): Promise<boolean>;

        /** Upload resource file */
        uploadResource(file: File, progress: (progress: number) => void, revisionOf?: string, path?: string, split?: boolean): Promise<{ processId?: string; error?: string; }>;

        /**
         * Create scene
         * @remarks
         * Only administrator may reate a scene.
         * Definition automatically saves to storage for future use.
         * @param scene {@link SceneDefinition}
         * @throws Error in case of insufficient access rights.
         */
        createScene(scene: SceneDefinition): Promise<{ success?: boolean; error?: string; }>;

        /** Get saved scene definition using for {@link createScene}*/
        getSceneDefinition(id: string): Promise<SceneDefinition>;

        /**
         * Get list of active processes.
         */
        getProcesses(): Promise<readonly ActiveProcess[]>;

        /**
         * Get process progress
         * @param id A process id
         * @param position A position returned by previous process progress
         * @returns State of process {@link ProcessProgress}
         */
        getProcessProgress(id: string, position?: number, signal?: AbortSignal): Promise<ProcessProgress>;

        /** Relative custom path request */
        fetch(path: string, init?: RequestInit | undefined): Promise<Response>;

        getWKZones(): string[];

        latLon2tm(coords: GeoLocation, tmZone: string): vec3;
    
        tm2LatLon(position: vec3, tmZone: string): GeoLocation;
    }

    /** Authentication header using for protected api calls*/
    export interface AuthenticationHeader {
        /** Authentication header name (Authentication, Set-Cookie, X-Api-Key etc) */
        header: string;
        /** Authentication header value (Bearer ..., "auth cookie name"="auth cookie value", "api key" etc*/
        value: string;
    }

    /** Server API creation options */
    export interface APIOptions {
        /** Callback returning {@link AuthenticationHeader} promise for protected api requests. */
        authHeader?: () => Promise<AuthenticationHeader>;
        /** Service url. e.g. "https://novorender.com". */
        serviceUrl?: string;
    }

    /**
     * Create an instance of the NovoRender Server API.
     * @remarks
     * The Server API requires that a user with appropriate access to server resources has already been logged in.
     * Unless you are developing a purely public web app, you may want to check the credentials property in the returned API and redirect to a login page if need be.
     * @param options Custom settings {@link ServerAPIOptions} to create API.
     * @returns An initialized API object
     */
    export function createAPI(options?: APIOptions): API;
}