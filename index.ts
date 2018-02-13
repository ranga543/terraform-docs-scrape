import * as fs from "fs";
import * as marked from "marked";
import * as cheerio from "cheerio";
import * as rp from "request-promise";
import * as path from "path";

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
providers.push({name: "terraform-provider-aws", url: `${terraformBaseUrl}/docs/providers/aws/index.html`});
providers.push({name: "terraform-provider-azurerm", url: `${terraformBaseUrl}/docs/providers/azurerm/index.html`});

function getProviderPage(p: IProvider): Promise<IParsedProvider> {
    return new Promise<IParsedProvider>((resolve, reject) => {
        rp(p.url).then((d) => {
            // tslint:disable-next-line:typedef
            var $ = cheerio.load(d);
            resolve({provider: p, result: $});
        }).then((error) => {
            reject(error);
        });
    });
}

function parseProvdierPage($: CheerioStatic, p: IProvider): Promise<IResource>[] {
    // var output: IOutput = {dataSources: new Array<IResource>(), resources: new Array<IResource>()};
    var promises: Promise<IResource>[] = new Array<Promise<IResource>>();
    $(".docs-sidebar .docs-sidenav > li").each((i, e) => {
        // assume starts with data sources
        if (i > 1) {
            // tslint:disable-next-line:typedef
            var currentItem = $(e);
            currentItem.find("li").each((si, se) => {
                var groupName: string = "", itemName: string = "", itemUrl: string = "";
                groupName = currentItem.children("a").first().text();
                console.log(`${i}.${groupName}`);

                console.log("Started processing");

                // tslint:disable-next-line:typedef
                var subListItem = $(se);
                // tslint:disable-next-line:typedef
                var link = subListItem.children("a").first();
                var itemPath: string = link.attr("href");
                itemName = link.text();
                itemUrl = terraformBaseUrl + itemPath;
                console.log(`${si}.${itemName}`);
                var pathParts: string[] = itemPath.split("/");
                var filePath: string = path.join(p.name, "website","docs",
                pathParts[pathParts.length - 2], pathParts[pathParts.length - 1]);
                console.log(`File path: ${filePath}`);
                var rType: string = pathParts[pathParts.length - 2] === "d" ? "data_source" : "resource";
                var r: IResource = {name: itemName, type: rType, url: itemUrl, groupName: groupName, args: [], attrs: []};
                promises.push(parseResourcePage(r, filePath));
                // if (pathParts[pathParts.length - 2] === "d") {
                //     output.dataSources.push(r);
                // } else {
                //     output.resources.push(r);
                // }
            });
        }
    });
    // return output;
    return promises;
}

function parseResourcePage(resource: IResource, filePath: string): Promise<IResource> {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(path.resolve(__dirname, filePath))) {
            filePath = filePath.substr(0, filePath.lastIndexOf(".")) + ".markdown";
            if (!fs.existsSync(path.resolve(__dirname, filePath))) {
                filePath = filePath.substr(0, filePath.lastIndexOf(".")) + ".html.markdown";
            }
        }
        var file: string = fs.readFileSync(path.resolve(__dirname, filePath)) + "";
        marked(file, (err, result) => {
            if (err) {
                reject(err);
            }
            // tslint:disable-next-line:typedef
            var $ = cheerio.load(result);
            resource.args = parseResourcePageArgs($);
            resource.attrs = parseResourcePageAttrs($);
            resolve(resource);
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
            console.log(field);
            defs.push({ name: field, description: desc, args: [] });
        });
    }
    return defs;
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
            console.log(field);
            defs.push({ name: field, description: desc, args: [] });
        });
    }
    return defs;
}

Promise.all(providers.map(getProviderPage)).then((results) => {
    results.forEach((v) => {
        Promise.all(parseProvdierPage(v.result, v.provider)).then((d) => {
            fs.writeFile(`${v.provider.name}.json`, JSON.stringify(d, null, 4), (err) => {
                console.log(`File successfully written! - Check your project directory for the ${v.provider.name}.json file`);
            });
        });
    });
});
