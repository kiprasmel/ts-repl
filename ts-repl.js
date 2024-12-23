#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { Project, SyntaxKind, Node } = require("ts-morph");

function tsReplCLI(argv = process.argv.slice(2)) {
	if (argv.length < 1) {
		console.error("at least 1 arg of the filepath is required.");
		process.exit(1);
	}

	let filepath;
	let opts = {};

	while (argv.length) {
		const arg = argv.shift();

		switch (arg) {
			case "-f":
			case "--force":
			case "--nocheck":
			case "--no-check": {
				opts.force = true;
				break;
			}
			default: {
				if (!filepath) filepath = arg;
				else errExit(`error: unknown arg "${arg}".`);
			}
		}
	}

	if (!fs.existsSync(filepath)) {
		console.error(`File not found: ${filepath}`);
		process.exit(1);
	}

	const tempFilePath = createTempFile(filepath);

	runTsNode(tempFilePath, opts);
}

function errExit(msg, code = 1) {
	process.stderr.write(msg);
	process.exit(code);
}

function createTempFile(filePath) {
	const tempFileName = `.tsrepl.${path.basename(filePath)}.${Date.now()}.ts`;
	const tempFilePath = tempFileName;

	// Use ts-morph to analyze the file
	const project = new Project();
	const sourceFile = project.addSourceFileAtPath(filePath);

	// Get the original file content
	const originalContent = sourceFile.getFullText();

	const { newExportStatements, allTopLevelSymbols } = getExportDeclarations(sourceFile);

	const tempFileContent = `\
${originalContent}

/** BEGIN TS_REPL */

// Additional exports for non-exported top-level symbols
${newExportStatements.join("\n")}

// REPL setup code
import * as __ts_repl__repl from 'repl';
import * as __ts_repl__vm from 'vm';
import * as __ts_repl__path from 'path';
import * as __ts_repl__os from 'os';
import * as __ts_repl__cp from 'child_process';

// Capture all top-level symbols
const __ts_repl__allSymbols = [${allTopLevelSymbols.map((s) => `'${s}'`).join(", ")}];

function __ts_repl__listAvailableSymbols(): void {
	console.log('available top-level symbols:');
	console.log(__ts_repl__allSymbols.join('\\n'));
}

function __ts_repl__createReplServer(context: __ts_repl__vm.Context, listSymbols: () => void): void {
	const historyFile = process.env.TS_REPL_HISTFILE || __ts_repl__path.join(__ts_repl__os.homedir(), '.ts_repl_history');

	// https://nodejs.org/api/repl.html
	const r = __ts_repl__repl.start({
		prompt: '> ',
		useGlobal: false,
		preview: true,
		eval: (cmd: string, context: __ts_repl__vm.Context, _filename: string, callback: (err: Error | null, result: any) => void) => {
			try {
				const result = __ts_repl__vm.runInContext(cmd, context);
				callback(null, result);
			} catch (e) {
				callback(e as Error, null);
			}
		}
	} as any); // TODO TS

	// Add all symbols to REPL context
	Object.assign(r.context, context);

	// Add listSymbols to REPL context
	r.context.listSymbols = listSymbols;

	// Setup history & more
	r.setupHistory(historyFile, (err: Error | null) => {
		if (err) {
			console.error(\`Error setting up REPL history: \${err}\`);
		} else {
			console.log(\`history: \${historyFile}\`);
		}
		r.displayPrompt();

		listSymbols();
		r.displayPrompt();
	});

	r.defineCommand("r", {
		help: "reload the REPL",
		action: () => {
			r.close();
			const cmd = \`${process.argv[0]}\`;
			const args = [${process.argv.slice(1).map(x => `"${x}"`).join(", ")}];
			__ts_repl__cp.spawn(cmd, args, {
				stdio: "inherit",
				shell: false,
			});
		}
	})
}

// Create a context with all symbols
const __ts_repl__context = __ts_repl__vm.createContext({...global, ...exports});

// Call createReplServer with the context
__ts_repl__createReplServer(__ts_repl__context, __ts_repl__listAvailableSymbols);

/** END TS_REPL */
`;

	fs.writeFileSync(tempFilePath, tempFileContent);
	return tempFilePath;
}

function getExportDeclarations(sourceFile) {
	// Find all top-level functions and variables
	const topLevelSymbols = sourceFile
		.getChildrenOfKind(SyntaxKind.VariableStatement)
		.concat(sourceFile.getChildrenOfKind(SyntaxKind.FunctionDeclaration))
		.concat(sourceFile.getChildrenOfKind(SyntaxKind.ClassDeclaration));

	// Arrays to store results
	const newExportStatements = [];
	const allTopLevelSymbols = new Set();

	// Get all existing exports
	const existingExports = new Set(
		sourceFile.getExportDeclarations().flatMap((exp) => exp.getNamedExports().map((ne) => ne.getName()))
	);

	// Process import declarations
	sourceFile.getImportDeclarations().forEach((importDecl) => {
		importDecl.getNamedImports().forEach((namedImport) => {
			const name = namedImport.getName();
			if (!existingExports.has(name)) {
				newExportStatements.push(`export { ${name} };`);
				allTopLevelSymbols.add(name);
			}
		});
	});

	// Iterate through the top-level symbols
	topLevelSymbols.forEach((symbol) => {
		if (Node.isVariableStatement(symbol) || Node.isFunctionDeclaration(symbol) || Node.isClassDeclaration(symbol)) {
			const declaration = Node.isVariableStatement(symbol) ? symbol.getDeclarationList().getDeclarations()[0] : symbol;
			const name = declaration.getName();

			if (name) {
				allTopLevelSymbols.add(name);

				if (!symbol.hasModifier(SyntaxKind.ExportKeyword)) {
					newExportStatements.push(`export { ${name} };`);
				}
			}
		}
	});

	return {
		newExportStatements,
		allTopLevelSymbols: Array.from(allTopLevelSymbols),
	};
}

function runTsNode(tempFilePath, opts) {
	console.log("compiling...");
	console.log(tempFilePath);

	const result = spawnSync(
		"ts-node",
		[
			"--compilerOptions",
			`'{"strict":true,"esModuleInterop":true,"allowJs":true,"noUnusedLocals":true,"noUnusedParameters":true}'`,
			"-r",
			"tsconfig-paths/register",
			opts.force ? "--transpileOnly" : "",
			tempFilePath,
		],
		{
			stdio: "inherit",
			shell: true,
			env: {
				...process.env,
				REPL: 1,
				TS_REPL: 1,
			},
		}
	);

	if (result.error) {
		console.error("Failed to start ts-node:", result.error);
		process.exit(1);
	}
}

module.exports = {
	tsReplCLI,
};

if (!module.parent) {
	tsReplCLI();
}
