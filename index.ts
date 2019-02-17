import * as fs from "fs";
import * as marked from "marked";
import * as cheerio from "cheerio";
import * as rp from "request-promise";
import * as path from "path";
var glob: any = require("glob");

const terraformBaseUrl: string = "https://www.terraform.io";
interface IProvider {
    name: string;
    url: string;
}
interface IParsedProvider {
    provider: IProvider;
    result: CheerioStatic;
}
interface IOutput {
    dataSources: IResource[];
    resources: IResource[];
}
interface IResource {
    name: string;
    type: string;
    groupName: string;
    url: string;
    args: IFieldDef[];
    attrs: IFieldDef[];
}

interface IFieldDef {
    name: string;
    description: string;
    args: IFieldDef[];
}

let providers: IProvider[] = new Array<IProvider>();
providers.push({ name: "terraform-provider-aws", url: `${terraformBaseUrl}/docs/providers/aws/index.html` });
providers.push({name: "terraform-provider-azurerm", url: `${terraformBaseUrl}/docs/providers/azurerm/index.html`});
providers.push({name: "terraform-provider-google", url: `${terraformBaseUrl}/docs/providers/google/index.html`});

const fieldRegex: RegExp = new RegExp(/^[a-z](?:_?[a-z0-9]+)*$/);

function getTerraformConfig(): void {
    var promises: Promise<any>[] = new Array<Promise<any>>();
    promises.push(getTerraformConfigInterpolation());
    promises.push(getTerraformConfigResources());
    promises.push(getTerraformConfigVariables());
    promises.push(getTerraformConfigOutputs());
    promises.push(getTerraformConfigModules());
    Promise.all(promises).then((v) => {
        var out: any = {};
        v.forEach((c) => {
            Object.keys(c).forEach((k) => {
                out[k] = c[k];
            });
        });
        fs.writeFile("terraform-config.json", JSON.stringify(out, null, 0), (err) => {
            console.log("File successfully written! - Check your project directory for the terraform-config.json file");
        });
    });
}

function getTerraformConfigInterpolation(): Promise<any> {
    return new Promise<any>((resolve, reject) => {
        rp(`${terraformBaseUrl}/docs/configuration/interpolation.html`).then((d) => {
            // tslint:disable-next-line:typedef
            var $ = cheerio.load(d);
            // h3 #supported-built-in-functions
            var defs: IFieldDef[] = parseTerraformConfigPageArgs($, "h3#supported-built-in-functions");
            var k: any = { builtInFunctions: [] };
            k.builtInFunctions = defs;
            resolve(k);
        }).then((error) => {
            reject(error);
        });
    });
}

function getTerraformConfigResources(): Promise<any> {
    return new Promise<any>((resolve, reject) => {
        rp(`${terraformBaseUrl}/docs/configuration/resources.html`).then((d) => {
            // tslint:disable-next-line:typedef
            var $ = cheerio.load(d);
            // h3 #supported-built-in-functions
            var defs: IFieldDef[] = parseTerraformConfigPageArgs($, "h3#meta-parameters", true);
            var k: any = { resource: [] };
            k.resource = defs;
            resolve(k);
        }).then((error) => {
            reject(error);
        });
    });
}

function getTerraformConfigVariables(): Promise<any> {
    return new Promise<any>((resolve, reject) => {
        rp(`${terraformBaseUrl}/docs/configuration/variables.html`).then((d) => {
            // tslint:disable-next-line:typedef
            var $ = cheerio.load(d);
            // h3 #supported-built-in-functions
            var defs: IFieldDef[] = parseTerraformConfigPageArgs($, "h2#description");
            var k: any = { variable: [] };
            k.variable = defs;
            resolve(k);
        }).then((error) => {
            reject(error);
        });
    });
}

function getTerraformConfigOutputs(): Promise<any> {
    return new Promise<any>((resolve, reject) => {
        rp(`${terraformBaseUrl}/docs/configuration/outputs.html`).then((d) => {
            // tslint:disable-next-line:typedef
            var $ = cheerio.load(d);
            // h3 #supported-built-in-functions
            var defs: IFieldDef[] = parseTerraformConfigPageArgs($, "h2#description");
            var k: any = { output: [] };
            k.output = defs;
            resolve(k);
        }).then((error) => {
            reject(error);
        });
    });
}

function getTerraformConfigModules(): Promise<any> {
    return new Promise<any>((resolve, reject) => {
        rp(`${terraformBaseUrl}/docs/configuration/modules.html`).then((d) => {
            // tslint:disable-next-line:typedef
            var $ = cheerio.load(d);
            // h3 #supported-built-in-functions
            var defs: IFieldDef[] = parseTerraformConfigPageArgs($, "h2#description");
            var k: any = { module: [] };
            k.module = defs;
            resolve(k);
        }).then((error) => {
            reject(error);
        });
    });
}

function parseTerraformConfigPageArgs($: CheerioStatic, filter: string, recursive: boolean = false): IFieldDef[] {
    var defs: IFieldDef[] = new Array<IFieldDef>();
    // tslint:disable-next-line:typedef
    var argsEle = $(`${filter}`).nextAll().filter("ul");

    if (argsEle.length > 0) {
        argsEle.first().children("li").each((ai, ae) => {
            // tslint:disable-next-line:typedef
            var liItem = $(ae);
            var field: string = liItem.find("code").first().text();
            var desc: string = liItem.text().replace(field, "").trim();
            var def: IFieldDef = { name: field, description: desc, args: [] };
            if (recursive) {
                parseChildArgsOrAttrs(liItem.html(), def);
            }
            if (field != null && field.length > 0) {
                defs.push(def);
            }
        });
    }
    return defs;
}

getTerraformConfig();

function getProviderPage(p: IProvider): Promise<IParsedProvider> {
    return new Promise<IParsedProvider>((resolve, reject) => {
        rp(p.url).then((d) => {
            // tslint:disable-next-line:typedef
            var $ = cheerio.load(d);
            resolve({ provider: p, result: $ });
        }).then((error) => {
            reject(error);
        });
    });
}

function parseProvdierPage($: CheerioStatic, p: IProvider): Promise<IResource>[] {
    var promises: Promise<IResource>[] = new Array<Promise<IResource>>();
    $(".docs-sidebar .docs-sidenav > li").each((i, e) => {
        // assume starts with data sources
        if (i > 1) {
            // tslint:disable-next-line:typedef
            var currentItem = $(e);
            currentItem.find("li").each((si, se) => {
                var groupName: string = "", itemName: string = "", itemUrl: string = "";
                groupName = currentItem.children("a").first().text();

                console.log("Started processing");

                // tslint:disable-next-line:typedef
                var subListItem = $(se);
                // tslint:disable-next-line:typedef
                var link = subListItem.children("a").first();
                var itemPath: string = link.attr("href");
                itemName = link.text();
                itemUrl = terraformBaseUrl + itemPath;
                var pathParts: string[] = itemPath.split("/");
                var filePath: string = path.join(p.name, "website", "docs",
                    pathParts[pathParts.length - 2], pathParts[pathParts.length - 1]);
                var rType: string = pathParts[pathParts.length - 2] === "d" ? "data_source" : "resource";
                var r: IResource = { name: itemName, type: rType, url: itemUrl, groupName: groupName, args: [], attrs: [] };
                if (path.dirname(filePath).indexOf("guides") === -1 && filePath.indexOf("?track=aws#aws")) {
                    promises.push(parseResourcePage(r, filePath));
                }
            });
        }
    });
    return promises;
}

function parseResourcePage(resource: IResource, filePath: string): Promise<IResource> {
    return new Promise((resolve, reject) => {
        console.log(`Read content of file: ${filePath}`);
        // tslint:disable-next-line:typedef
        glob(filePath.substr(0, filePath.lastIndexOf(".")) + ".*", {}, function (er, files) {
            if (er) {
                console.log("Error ocurred while searching for " + filePath);
                reject(er);
            }
            if (files && files.length > 0) {
                // reject(`Unable to find files for: ${filePath}`);

                var file: string = fs.readFileSync(path.resolve(__dirname, files[0])) + "";
                marked(file, (err, result) => {
                    if (err) {
                        reject(err);
                    }
                    // tslint:disable-next-line:typedef
                    var $ = cheerio.load(result);
                    resource.args = parseResourcePageArgs($);
                    parseNestedBlocksArgs($, resource.args);
                    resource.attrs = parseResourcePageAttrs($);
                    resolve(resource);
                });

            }
        });
    });
}

function parseResourcePageArgs($: CheerioStatic): IFieldDef[] {
    var defs: IFieldDef[] = new Array<IFieldDef>();
    // tslint:disable-next-line:typedef
    var argsEle = $("#argument-reference").nextUntil("#attributes-reference").filter("ul");

    if (argsEle.length > 0) {
        argsEle.first().children("li").each((ai, ae) => {
            // tslint:disable-next-line:typedef
            var liItem = $(ae);
            var field: string = liItem.find("code").first().text();
            var desc: string = liItem.text().replace(field, "").replace("-", "").trim();
            var def: IFieldDef = { name: field, description: desc, args: [] };
            parseChildArgsOrAttrs(liItem.html(), def);
            if (field != null && field.length > 0 && fieldRegex.test(def.name)) {
                defs.push(def);
            }
        });
    }
    return defs;
}

function searchArgs(args: IFieldDef[], search: string): IFieldDef {
    // var formatSearch: string = search.replace(/_|-|./g, " ");
    for (let i: number = 0; i < args.length; i++) {
        let a: IFieldDef = args[i];
        // tslint:disable-next-line:triple-equals
        if (search.toLowerCase().includes(a.name.replace(/_|-/g, " ").toLowerCase())) {
            return a;
        }
        if (a.args.length > 0) {
            searchArgs(a.args, search);
        }
    }
    return null;
}

function parseNestedBlocksArgs($: CheerioStatic, args: IFieldDef[]): void {
    // tslint:disable-next-line:typedef
    var argsEle = $("#argument-reference").nextUntil("#attributes-reference").filter("ul");
    argsEle.nextUntil("#attributes-reference").filter("ul").each((i, e) => {
        // tslint:disable-next-line:typedef
        var currentUlTag = $(e);
        if (currentUlTag.find("code").length > 0) {
            var formatSearch: string = currentUlTag.prev().text().replace(/_|-/g, " ");
            var def: IFieldDef = searchArgs(args, formatSearch);
            currentUlTag.children("li").each((ai, ae) => {
                // tslint:disable-next-line:typedef
                var liItem = $(ae);
                var field: string = liItem.find("code").first().text();
                var desc: string = liItem.text().replace(field, "").replace("-", "").trim();
                var childDef: IFieldDef = { name: field, description: desc, args: [] };
                parseChildArgsOrAttrs(liItem.html(), def);
                if (field != null && field.length > 0 && fieldRegex.test(field)) {
                    if (def != null && def.name !== "") {
                        def.args.push(childDef);
                    } else {
                        args.push(childDef);
                    }
                }
            });
        }
    });
}

function parseChildArgsOrAttrs(a: string, item: IFieldDef): void {
    // tslint:disable-next-line:typedef
    var $ = cheerio.load(a);
    var l: number = $("ul").length;
    if (l > 0) {
        // tslint:disable-next-line:typedef
        var ulTag = $("ul");
        ulTag.children("li").each((i, e) => {
            // tslint:disable-next-line:typedef
            var a = $(e);
            var field: string = a.find("code").first().text();
            var desc: string = a.text().replace(field, "").replace("-", "").trim();
            var def: IFieldDef = { name: field, description: desc, args: [] };
            if (field != null && field.length > 0 && item != null
                && item !== undefined && item.name.length > 0) {
                if (field.includes(`${item.name}.`)) {
                    def.name = def.name.replace(`${item.name}.`, "").replace("#", "");
                }
                if (fieldRegex.test(def.name)) {
                    item.args.push(def);
                }
            }
            parseChildArgsOrAttrs(a.html(), def);
        });
    }
}

function parseResourcePageAttrs($: CheerioStatic): IFieldDef[] {
    var defs: IFieldDef[] = new Array<IFieldDef>();
    // tslint:disable-next-line:typedef
    var attrEle = $("#attributes-reference").nextAll().filter("ul");

    if (attrEle.length > 0) {
        attrEle.first().children("li").each((ai, ae) => {
            // tslint:disable-next-line:typedef
            var liItem = $(ae);
            var field: string = liItem.find("code").first().text();
            var desc: string = liItem.text().replace(field, "").replace("-", "").trim();
            var def: IFieldDef = { name: field, description: desc, args: [] };
            parseChildArgsOrAttrs(liItem.html(), def);
            if (field != null && field.length > 0 && fieldRegex.test(def.name)) {
                defs.push(def);
            }
        });
    }
    return defs;
}

Promise.all(providers.map(getProviderPage)).then((results) => {
    results.forEach((v) => {
        Promise.all(parseProvdierPage(v.result, v.provider)).then((d) => {
            var data: { [key: string]: IResource } = d.filter((t) => t.type === "data_source").reduce((obj, item) => {
                obj[item.name] = item;
                return obj;
            }, {});
            var resource: { [key: string]: IResource } = d.filter((t) => t.type === "resource").reduce((obj, item) => {
                obj[item.name] = item;
                return obj;
            }, {});
            var out: ITerraformData = { data: data, resource: resource };
            fs.writeFile(`${v.provider.name}.json`, JSON.stringify(out, null, 0), (err) => {
                console.log(`File successfully written! - Check your project directory for the ${v.provider.name}.json file`);
            });
        });
    });
});


export interface ITerraformData {
    data: { [key: string]: IResource };
    resource: { [key: string]: IResource };
}
