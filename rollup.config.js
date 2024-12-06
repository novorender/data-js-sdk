import del from "rollup-plugin-delete";
import commonjs from "@rollup/plugin-commonjs";
import copy from "rollup-plugin-copy";
import consts from 'rollup-plugin-consts';
import resolve from "@rollup/plugin-node-resolve";
import sourcemaps from "rollup-plugin-sourcemaps";
import { terser } from "rollup-plugin-terser";
import generatePackageJson from "rollup-plugin-generate-package-json";
import emitEJS from "rollup-plugin-emit-ejs";

import * as packageJson from "./package.json";

const isDevelopment = process.env.BUILD === "development";

const common = {
    output: {
        name: "NovoRenderData", // for UMD format
        format: "es",
        sourcemap: isDevelopment,
        preferConst: true,
        chunkFileNames: "[name].js",
        compact: !isDevelopment,
        plugins: [!isDevelopment && terser({ ecma: 2017, compress: { ecma: 2017, drop_console: true, global_defs: { env: { DEBUG: false } } } })],
    },
    plugins: [
        consts({
            version: packageJson.version,
            env: { DEBUG: isDevelopment },
        }),
        resolve(),
        commonjs(),
        // json({ preferConst: true }),
        isDevelopment && sourcemaps(),
        !isDevelopment && terser({ ecma: 2017, compress: { ecma: 2017, drop_console: true, global_defs: { env: { DEBUG: false } } } }),
    ],
};

export default [
    {
        ...common,
        input: "js/index.js",
        output: {
            ...common.output,
            file: "dist/index.js",
            format: "es",
        },
        plugins: [
            ...common.plugins,
            del({ targets: "dist/*" }),
            copy({
                targets: [
                    { src: "src/types.d.ts", dest: "dist/", rename: "index.d.ts" },
                ]
            }),
            emitEJS({
                src: "src",
                include: "README.md",
                data: {
                    packageJson,
                    glMatrixVersion: packageJson.dependencies["gl-matrix"]
                }
            }),
            generatePackageJson({
                baseContents: {
                    name: "@novorender/data-js-api",
                    description: "A js API for data access using in @novorender/webgl-api.",
                    author: "Novorender AS",
                    version: packageJson.version,
                    module: "index.js",
                    typings: "index.d.ts",
                    license: "UNLICENSED",
                    scripts: {
                    },
                    dependencies: {
                        "gl-matrix": packageJson.dependencies["gl-matrix"]
                    },
                    optionalDependencies: {
                        "@novorender/webgl-api": packageJson.devDependencies["@novorender/webgl-api"]
                    }
                }
            }),
        ],
    },
    {
        ...common,
        input: "js/index.js",
        output: {
            ...common.output,
            file: "dist/index_umd.js",
            format: "umd",
            name: "NovoRenderData"
        },
    },
];
