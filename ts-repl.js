#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Project, SyntaxKind } = require('ts-morph');

function tsReplCLI(argv = process.argv.slice(2)) {
	if (argv.length < 1) {
		console.error('Please provide a TypeScript file path.');
		process.exit(1);
	}

	const filePath = path.resolve(argv[0]);

	if (!fs.existsSync(filePath)) {
		console.error(`File not found: ${filePath}`);
		process.exit(1);
	}

	const tempFilePath = createTempFile(filePath);

	console.log("compiling...");
	runTsNode(tempFilePath);

	// Clean up the temporary file
	// fs.unlinkSync(tempFilePath);
}

function createTempFile(filePath) {
	const tempDir = path.join(os.tmpdir(), "ts-repl");
	fs.mkdirSync(tempDir, { recursive: true });
	const tempFileName = new Date().getTime() + "." + path.basename(filePath);
	const tempFilePath = path.join(tempDir, tempFileName);
	
	// Use ts-morph to analyze and modify the file
	const project = new Project();
	const sourceFile = project.addSourceFileAtPath(filePath);
	
	// Find all symbols and export them if they're not already exported
	const symbols = sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)
		.map(id => id.getText())
		.filter((value, index, self) => self.indexOf(value) === index); // Remove duplicates
	
	const exportStatements = symbols.map(symbol => `export { ${symbol} };`).join('\n');
	
	// Append export statements to the end of the file
	sourceFile.addStatements(exportStatements);
	
	// Get the modified source code
	const modifiedCode = sourceFile.getFullText();
	
	const tempFileContent = `\
// Modified source code with all symbols exported
${modifiedCode}

import * as __ts_repl__repl from 'repl';
import * as __ts_repl__vm from 'vm';
import * as __ts_repl__path from 'path';
import * as __ts_repl__os from 'os';


// Capture all symbols
const __ts_repl__allSymbols = [${symbols.map(s => `'${s}'`).join(', ')}];

function __ts_repl__listAvailableSymbols(): void {
	console.log('symbols:');
	console.log(__ts_repl__allSymbols.join(', '));
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
				const result =  __ts_repl__vm.runInContext(cmd, context);
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

		__ts_repl__listAvailableSymbols();
		r.displayPrompt();
	});
}

// Create a context with all symbols
const __ts_repl__context = __ts_repl__vm.createContext({...global, ...exports});

// Call createReplServer with the context
__ts_repl__createReplServer(__ts_repl__context, __ts_repl__listAvailableSymbols);
`;

	fs.writeFileSync(tempFilePath, tempFileContent);
	return tempFilePath;
}

function runTsNode(tempFilePath) {
	const result = spawnSync('ts-node', [
		'--compilerOptions', `'{"strict":true,"esModuleInterop":true,"allowJs":true,"noUnusedLocals":true,"noUnusedParameters":true}'`,
		'-r', 'tsconfig-paths/register',
		tempFilePath
	], {
		stdio: 'inherit',
		shell: true
	});

	if (result.error) {
		console.error('Failed to start ts-node:', result.error);
		process.exit(1);
	}
}

module.exports = {
	tsReplCLI,
};

if (!module.parent) {
	tsReplCLI();
}
