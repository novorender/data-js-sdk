import * as Core from "@novorender/webgl-api";
import * as Public from "@novorender/data-js-api";
import { vec3, glMatrix, vec2 } from "gl-matrix";
import proj4 from "proj4";

glMatrix.setMatrixArrayType(Array);

async function* streamTextLines(url: string, requestInit?: RequestInit | undefined): AsyncIterableIterator<string> {
    const response = await fetch(url, requestInit);
    if (!response.ok) {
        throw new Error(`Failed to retreive scene metadata: ${response.status} ${response.statusText}`);
    }
    if (response.body) {
        const reader = response.body.getReader();
        const utf8Decoder = new TextDecoder("utf-8");
        let { value: chunk, done: readerDone } = await reader.read();
        let text = chunk ? utf8Decoder.decode(chunk) : "";

        let re = /\r\n|\n|\r/gm;
        let startIndex = 0;

        for (; ;) {
            let result = re.exec(text);
            if (!result) {
                if (readerDone) {
                    break;
                }
                let remainder = text.substr(startIndex);
                ({ value: chunk, done: readerDone } = await reader.read());
                text = remainder + (chunk ? utf8Decoder.decode(chunk) : "");
                startIndex = re.lastIndex = 0;
                continue;
            }
            yield text.substring(startIndex, result.index);
            startIndex = re.lastIndex;
        }
        if (startIndex < text.length) {
            // last line didn't end in a newline char
            yield text.substr(startIndex);
        }
    }
}
function tryParse(str: string) {
    try {
        return JSON.parse(str);
    } catch (e) {
        return undefined;
    }
}

async function* getFromCosmos2(db: { [id: number]: Public.ObjectData; }, loadMetaData: (id: number) => Promise<Public.ObjectData>, url: string, auth: (init?: RequestInit | undefined) => Promise<RequestInit | undefined>, filter: Public.SearchOptions, signal?: AbortSignal): AsyncIterableIterator<Public.HierarcicalObjectReference> {
    let continuation = "";
    let errors = 0;
    while (true) {
        const body = new Blob([JSON.stringify({ path: filter.parentPath, descendants: filter.descentDepth, search: filter.searchPattern, continuation, full: filter.full })], { type: 'application/json' });
        const requestInit = await auth({
            method: "POST",
            headers: [["Accept", "text/plain"]],
            signal,
            body,
        });
        const lines = streamTextLines(`${url}/search`, requestInit);
        continuation = (await lines.next()).value;
        for await (const line of lines) {
            if (signal?.aborted) break;
            const md = tryParse(line) as Public.HierarcicalObjectReference;
            if (!md) {
                errors++;
                continue;
            }
            let dbmd = db[md.id];
            if (filter.full) {
                if (!dbmd) {
                    dbmd = md as Public.ObjectData;
                    db[md.id] = dbmd;
                } else {
                    const metadata = dbmd as any;
                    const _md = md as Public.ObjectData;
                    metadata.name = _md.name;
                    metadata.path = _md.path;
                    metadata.properties = _md.properties;
                    metadata.url = _md.url;
                    metadata.description = _md.description;
                    metadata.id = _md.id;
                    metadata.type = _md.type;
                    metadata.bounds = _md.bounds;
                }
                dbmd.loadMetaData = loadMetaData as () => Promise<Public.ObjectData>;
            }
            else if (!dbmd) {
                dbmd = md as Public.ObjectData;
                dbmd.loadMetaData = () => { return loadMetaData(md.id); };
                db[md.id] = dbmd;
            }
            yield dbmd;
        }
        if (!continuation) break;
    }
}

class RemoteMetadataDB implements Public.ObjectDB {
    private db: { [id: number]: Public.ObjectData; } = {};

    private loadMetaData(): Promise<Public.ObjectData> {
        return Promise.resolve(this as any as Public.ObjectData);
    }
    private save = async (obj: Public.ObjectData): Promise<boolean> => {
        const _obj = {
            name: obj.name,
            path: obj.path,
            properties: obj.properties,
            url: obj.url,
            description: obj.description,
            id: obj.id,
            type: obj.type,
            bounds: obj.bounds
        };
        const body = new Blob([JSON.stringify(_obj)], { type: 'application/json' });
        const requestInit = await this.auth({
            method: "POST",
            body,
        });
        const response = await fetch(this.url, requestInit);
        return response.ok;
    }

    private loadCompleteMetadata = async (id: number) => {
        let metadata: any = this.db[id];
        if (!metadata || !metadata.name) {
            const response = await fetch(`${this.url}/${id}`, await this.auth());
            if (!response.ok)
                throw new Error(response.statusText);
            const md = (await response.json()) as Public.ObjectData;
            if (!metadata) {
                metadata = md;
                this.db[id] = metadata;
            } else {
                metadata.name = md.name;
                metadata.path = md.path;
                metadata.properties = md.properties;
                metadata.url = md.url;
                metadata.description = md.description;
                metadata.id = md.id;
                metadata.type = md.type;
                metadata.bounds = md.bounds;
            }
            metadata.loadMetaData = this.loadMetaData;
            metadata.save = async () => { return await this.save(metadata) };
        }
        return metadata;
    };

    constructor(readonly url: string, readonly auth: (init?: RequestInit | undefined) => Promise<RequestInit | undefined>, readonly assetUrl: string) { }

    getObjectMetdata(id: number): Promise<Public.ObjectData> {
        return this.loadCompleteMetadata(id);
    }

    search(filter: Public.SearchOptions, signal?: AbortSignal): AsyncIterableIterator<Public.HierarcicalObjectReference> {
        return getFromCosmos2(this.db, filter.full ? this.loadMetaData : this.loadCompleteMetadata, this.url, this.auth, filter, signal);
    }

    async descendants(object: Public.HierarcicalObjectReference, signal: AbortSignal | undefined): Promise<Public.ObjectId[]> {
        if (!object.descendants) {
            try {
                const url = new URL(this.assetUrl);
                url.pathname += `descendants/${object.id}`;
                const descendants: Public.ObjectId[] = [];
                const stream = streamTextLines(url.toString(), { signal });
                for await (const s of stream) descendants.push(parseInt(s) as Public.ObjectId);
                (object as any).descendants = descendants;
            } catch {
                (object as any).descendants = [];
            }
        }
        return object.descendants ?? [];
    }
}

export class API implements Public.API {
    constructor(readonly authHeader: (() => Promise<Public.AuthenticationHeader>) | undefined, readonly serviceUrl: string) { }

    private lastAppToken: string = "-1";
    private token: string = "";

    private auth = async (init?: RequestInit) => {
        const header = this.authHeader ? await this.authHeader() : undefined;
        if (!header?.header || !header?.value) return init;
        // if (this.lastAppToken !== header.value) {
        //     const res = await fetch(`${this.serviceUrl}/user/token`, { mode: "cors", headers: [[header.header, header.value]] });
        //     this.token = "Bearer " + (await res.text());
        //     this.lastAppToken = header.value;
        // }
        // const headerName = "X-Novorender-Token";
        const headerName = header.header;
        this.token = header.value;
        if (!init) init = {};
        if (!init.mode) init.mode = "cors";
        if (!init.headers) init.headers = [[headerName, this.token]];
        else if (init.headers instanceof Headers) init.headers.append(headerName, this.token);
        else if (Array.isArray(init.headers)) init.headers.push([headerName, this.token]);
        else init.headers[headerName] = this.token;
        return init;
    }

    async getUserInformation(): Promise<{ name: string; organization: string; role: string | undefined; features: any; } | undefined> {
        const res = await fetch(`${this.serviceUrl}/user`, await this.auth());
        const data = await res.json();
        return { name: data?.user, organization: data?.organization, role: data?.role || undefined, features: data?.features };
    }
    async getScenes(): Promise<readonly Public.ScenePreview[]> {
        const res = await fetch(`${this.serviceUrl}/scenes`, await this.auth());
        const data: Public.ScenePreview[] = await res.json();
        // if (data.some(sp => sp.id === "9fb7bdf8ae8445189573681194718db8"))
        return data;
        // return [{ id: "9fb7bdf8ae8445189573681194718db8", title: "Oil Rig" }]
        //     .concat(data);
    }
    async loadScene(id: string): Promise<Public.SceneData> {
        const res = await fetch(`${this.serviceUrl}/scenes/${id}`, await this.auth());
        const data = await res.json();
        if (!res.ok) {
            data.statusCode = res.status;
        }
        // const db = data.cosmosDB ? new RemoteMetadataDB(`${this.serviceUrl}/metadata/${id}`, this.auth) : undefined;
        const db = new RemoteMetadataDB(`${this.serviceUrl}/metadata/${id}`, this.auth, data.url);
        data.db = db;
    
        const { settings, selectedObjects, hiddenObjects, cameraBookmarks } = data;
        if (!data.objectGroups) {
            data.objectGroups = [];
            if (settings) {
                const def = { id: "", name: "default", ids: [], color: [1, 0, 0], selected: true, hidden: false } as Public.ObjectGroup;
                let addDef = false;
                if (settings.selectedObjects?.color) {
                    def.color = vec3.copy(vec3.create(), settings.selectedObjects.color);
                    addDef = true;
                }
                if (selectedObjects) {
                    def.ids = selectedObjects;
                    delete data.selectedObjects;
                    addDef = true;
                }
                if (addDef) data.objectGroups.push(def);
                if (hiddenObjects) {
                    data.objectGroups.push({ id: "", name: "defaultHidden", ids: hiddenObjects, color: [1, 0, 0], selected: false, hidden: true });
                }
            }
        } else {
            for (const g of (data.objectGroups as Public.ObjectGroup[])) {
                if (!g.id && g.name !== "default" && g.name !== "defaultHidden") {
                    var d = new Date().getTime();//Timestamp
                    var d2 = (performance?.now() ?? 0) * 1000;
                    g.id = 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                        var r = Math.random() * 16;//random number between 0 and 16
                        if (d > 0) {//Use timestamp until depleted
                            r = (d + r) % 16 | 0;
                            d = Math.floor(d / 16);
                        } else {//Use microseconds since page-load if supported
                            r = (d2 + r) % 16 | 0;
                            d2 = Math.floor(d2 / 16);
                        }
                        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
                    });
                }
            }
        }
        if (settings?.clippingPlanes) settings.clippingPlanes.bounds = { min: vec3.copy(vec3.create(), settings.clippingPlanes.bounds.min), max: vec3.copy(vec3.create(), settings.clippingPlanes.bounds.max) }
        if (cameraBookmarks) {
            data.bookmarks = cameraBookmarks.map(({ name, properties }: { name: string, properties: Core.CameraProperties }) => ({ name, camera: properties } as Public.Bookmark))
            delete data.cameraBookmarks;
        }

        return data;
    }
    async putScene(scene: Public.SceneData): Promise<boolean> {
        const [id, mainscene] = scene.url.split(":");
        // const { title } = scene;
        (scene as any).url = undefined;
        // (scene as any).title = undefined;
        const body = new Blob([JSON.stringify(scene)], { type: 'application/json' });
        const url = `${this.serviceUrl}/scenes/${id}/ ${mainscene ? `/${mainscene}` : ""}`;
        const requestInit = await this.auth({
            method: "POST",
            body,
        });
        const response = await fetch(url, requestInit);
        return response.ok;
    }

    async getBookmarks(id: string, options?: { group?: string, personal?: boolean }): Promise<Public.Bookmark[]> {
        const res = await fetch(`${this.serviceUrl}/scenes/${id}/${options?.personal ? "personal" : ""}bookmarks${options?.group ? ("/" + options.group) : ""}`, await this.auth());
        return await res.json();
    }

    async saveBookmarks(id: string, bookmarks: Public.Bookmark[], options?: { group?: string, personal?: boolean}): Promise<boolean> {
        const body = new Blob([JSON.stringify(bookmarks)], { type: 'application/json' });
        const url = `${this.serviceUrl}/scenes/${id}/${options?.personal ? "personal":""}bookmarks${options?.group ? ("/"+options.group) : ""}`;
        const requestInit = await this.auth({
            method: "POST",
            body,
        });
        const response = await fetch(url, requestInit);
        return response.ok;
    }

    async getGroupIds(sceneId: string, id: string): Promise<Public.ObjectId[]> {
        const res = await fetch(`${this.serviceUrl}/scenes/${sceneId}/group/${id}`, await this.auth());
        return await res.json();
        // const lines = streamTextLines(`${this.serviceUrl}/scenes/${sceneId}/group/${id}`, await this.auth());
        // const data: Public.ObjectId[] = []
        // for await (const line of lines) {
        //     if(line) data.push(parseInt(line));
        // }
        // return data;
    }

    async deleteScene(id: string): Promise<boolean> {
        const url = `${this.serviceUrl}/scenes/${id}`;
        const requestInit = await this.auth({
            method: "DELETE"
        });
        const response = await fetch(url, requestInit);
        return response.ok;
    }

    async getResources(): Promise<Public.Resource[]> {
        const res = await fetch(`${this.serviceUrl}/resources`, await this.auth());
        const data: Public.Resource[] = (await res.json()).map((r: any) => {
            if(r.tags) r.tags = r.tags.split(";");
            return r;
        });
        return data;
    }

    async updateResource(resource: Public.Resource): Promise<boolean> {
        const url = `${this.serviceUrl}/resources`;
        const res = { ...resource, tags: resource.tags?.join(";") };
        const requestInit = await this.auth({
            method: "POST",
            body: JSON.stringify(res),
            headers: [["content-type", "application/json"]]
        });
        const response = await fetch(url, requestInit);
        return response.ok;
    }

    async deleteResource(id: string): Promise<boolean> {
        const url = `${this.serviceUrl}/resources/${id}`;
        const requestInit = await this.auth({
            method: "DELETE"
        });
        const response = await fetch(url, requestInit);
        return response.ok;
    }

    async getResource(id: string): Promise<Public.ResourcePreview> {
        const url = `${this.serviceUrl}/resources/${id}`;
        const requestInit = await this.auth({});
        const response = await fetch(url, requestInit);
        const preview = (await response.json()) as Public.ResourcePreview;
        return preview;
    }

    async uploadResource(file: File, progress: (progress: number) => void, revisionOf?: string, path?: string, split?: boolean): Promise<{ processId?: string; error?: string; }> {
        try {
            const blockSize = 1048576;
            progress(0);
            const id = Date.now().valueOf();

            const requestInit = await this.auth({
                method: "Get",
                cache: "no-cache",
                referrerPolicy: "origin-when-cross-origin",
                keepalive: true
            });
            // this.log = `Uploading "${file.name}"...`;
            const uploadUrlResponse = await fetch(`${this.serviceUrl}/upload/${id}`, requestInit);
            if (!uploadUrlResponse.ok) return { error: uploadUrlResponse.statusText };
            const uploadUrl = await uploadUrlResponse.text();

            if (file.size > blockSize) {
                const blocks: string[] = [];
                let cursor = 0;
                const proms: Promise<Response>[] = [];
                let done = 0;
                let count = 0;
                while (cursor < file.size) {
                    const part = file.slice(cursor, Math.min(file.size, cursor + blockSize));
                    const bid = '00000000000' + blocks.length.toString();
                    const blockId = btoa(bid.substr(bid.length - 12));
                    blocks.push(blockId);
                    cursor += blockSize;
                    while (count > 15) await new Promise(resolve => setTimeout(resolve, 100));
                    count++;
                    proms.push(fetch(`${uploadUrl}&comp=block&blockid=${blockId}`,
                        {
                            method: "PUT",
                            body: part,
                            referrerPolicy: "origin-when-cross-origin",
                            headers: [["x-ms-blob-type", "BlockBlob"]]
                        }).then(res => {
                            count--;
                            if (!res.ok) {
                                throw new Error(res.statusText);
                            }
                            done += blockSize;
                            progress(done / file.size);
                            return res;
                        }));
                }
                try {
                    await Promise.all(proms);
                } catch (e) {
                    return { error: "Failed" };
                }
                const commitResponse = await fetch(`${uploadUrl}&comp=blocklist`,
                    {
                        method: "PUT",
                        body: `<?xml version="1.0" encoding="utf-8"?><BlockList>${blocks.map(b => `<Latest>${b}</Latest>`).join("")}</BlockList>`,
                        referrerPolicy: "origin-when-cross-origin",
                        headers: [['x-ms-blob-content-type', file.type]]
                    });
                if (!commitResponse.ok) return { error: commitResponse.statusText };
            } else {
                // Upload file directly to storage server.
                const uploadResponse = await fetch(uploadUrl, { method: "PUT", body: file, referrerPolicy: "origin-when-cross-origin", headers: [["x-ms-blob-type", "BlockBlob"]] });
                if (!uploadResponse.ok) return { error: uploadResponse.statusText };
            }
            // Start processing uploaded file.
            // this.log = "Processing...";
            const processResponse = await fetch(`${this.serviceUrl}/resource/${id}?fileName=${encodeURIComponent(file.name)}&size=${(file.size / 1048576).toFixed(0)}&revision=${revisionOf ?? ""}&path=${path ?? ""}${split?"&split=true":""}`,
                await this.auth({
                    method: "POST",
                    body: "{}",
                    headers: [["content-type", "application/json"]]
                }));
            if (!processResponse.ok) {
                return { error: processResponse.statusText };
            }
            return {
                processId: id.toString()
            };
        } catch (e) {
            return { error: "Failed" };
        }
    }

    async createScene(scene: Public.SceneDefinition): Promise<{ success?: boolean; error?: string; }> {
        try {
            const processResponse = await fetch(`${this.serviceUrl}/process`,
                await this.auth({
                    method: "POST",
                    body: JSON.stringify(scene),
                    headers: [["content-type", "application/json"]]
                }));
            if (!processResponse.ok) {
                return { error: processResponse.statusText };
            }
            return await processResponse.json();
        } catch (e) {
            return { error: `Failed: ${JSON.stringify(e)}` };
        }
    }
    async getSceneDefinition(id: string): Promise<Public.SceneDefinition> {
        const res = await fetch(`${this.serviceUrl}/scenes/${id}/config`, await this.auth());
        return await res.json();
    }

    async getProcesses(): Promise<readonly Public.ActiveProcess[]> {
        const res = await fetch(`${this.serviceUrl}/process`, await this.auth());
        const data: readonly Public.ActiveProcess[] = await res.json();
        return data;
    }

    async getProcessProgress(id: string, position?: number, signal?: AbortSignal): Promise<Public.ProcessProgress> {
        try {
            const response = await fetch(`${this.serviceUrl}/progress/${id}?position=${position}`, await this.auth({ signal, keepalive: true }));
            if (!response.ok) return { text: response.statusText, complete: true, position: 0 };
            return await response.json();
        } catch (e) {
            return { text: JSON.stringify(e, undefined, "  "), complete: true, position: 0 };
        }
    }

    async fetch(path: string, init?: RequestInit | undefined): Promise<Response> {
        return await fetch(`${this.serviceUrl}/${path}`, await this.auth(init));
    }

    getWKZones(): string[] {
        return WKZones.map(z => z[0]);
    }

    latLon2tm(coords: Core.GeoLocation, tmZone: string): vec3 {
        const res = proj4(tmZone).forward([coords.longitude, coords.latitude]);
        return vec3.fromValues(res[0], res[1], 0);
    }

    tm2LatLon(position: vec3, tmZone: string): Core.GeoLocation {
        const res = proj4(tmZone).inverse([position[0], position[1]]);
        return { longitude: res[0], latitude: res[1] };
    }
}

const WKZones = 
    Array.from(Array(60).keys()).map(k => {
        const zone = k + 1;
        return [
            [`WGS 84 / UTM zone ${zone}N`, `PROJCS["WGS 84 / UTM zone ${zone}N",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",${ k * 6 - 177}],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",0],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["Easting",EAST],AXIS["Northing",NORTH],AUTHORITY["EPSG","${32600 + zone}"]]`],
            [`WGS 84 / UTM zone ${zone}S`, `PROJCS["WGS 84 / UTM zone ${zone}S",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",${ k * 6 - 177}],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",10000000],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["Easting",EAST],AXIS["Northing",NORTH],AUTHORITY["EPSG","${32700 + zone}"]]`]
        ];
    }).flat()
    .concat(Array.from(Array(26).keys()).map(k => {
        const zone = k + 5;
        return [`ETRS89 / NTM zone ${zone}`, `PROJCS["ETRS89 / NTM zone ${zone}",GEOGCS["ETRS89",DATUM["European_Terrestrial_Reference_System_1989",SPHEROID["GRS 1980",6378137,298.257222101,AUTHORITY["EPSG","7019"]],TOWGS84[0,0,0,0,0,0,0],AUTHORITY["EPSG","6258"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4258"]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",58],PARAMETER["central_meridian",${zone + 0.5}],PARAMETER["scale_factor",1],PARAMETER["false_easting",100000],PARAMETER["false_northing",1000000],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AUTHORITY["EPSG","${5100 + zone}"]]`]
    }));

proj4.defs(WKZones);

/**
 * Create an instance of the NovoRender Server API.
 * @remarks
 * The Server API requires that a user with appropriate access to server resources has already been logged in.
 * Unless you are developing a purely public web app, you may want to check the credentials property in the returned API and redirect to a login page if need be.
 * @param options Custom settings {@link ServerAPIOptions} to create API.
 * @returns An initialized API object
 */
export function createAPI(options?: Public.APIOptions): Public.API {
    return new API(options?.authHeader, options?.serviceUrl ?? "https://novorender.com/api");
}

export enum NodeType {
    Internal = 0,
    Leaf = 1
}

export enum AccessType {
    Read,
    ReadWrite
}
