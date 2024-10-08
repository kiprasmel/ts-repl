#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Module = require('module');

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
	fs.unlinkSync(tempFilePath);
}

function createTempFile(filePath) {
	const tempDir = os.tmpdir();
	const tempFileName = path.basename(filePath);
	const tempFilePath = path.join(tempDir, tempFileName);
	const filePathWithoutExtension = filePath.replace(/\.(ts|js)$/, '');
	const tempFileContent = `
import * as repl from 'repl';
import * as vm from 'vm';
import * as path from 'path';
import * as os from 'os';

// Intercept require to capture all symbols
const originalRequire = require('module').prototype.require;
require('module').prototype.require = function() {
	const exports = originalRequire.apply(this, arguments);
	if (arguments[0] === '${filePathWithoutExtension}') {
		console.log(exports)
		const mod = this;
		console.log(mod)
		console.log(mod.children[0])
		Object.keys(mod).forEach(key => {
			if (key !== 'exports' && key !== 'require' && key !== 'module') {
				exports[key] = mod[key];
			}
		});
	}
	return exports;
};

const providedFileModule = require('${filePathWithoutExtension}');

// Restore original require
require('module').prototype.require = originalRequire;

// Capture all symbols
const allSymbols = Object.keys(providedFileModule);

function listAvailableSymbols(): void {
	console.log('symbols:');
	console.log(allSymbols.join(', '));
}

function createReplServer(fileModule: any, listSymbols: () => void): void {
	const historyFile = process.env.TS_REPL_HISTFILE || path.join(os.homedir(), '.ts_repl_history');

	// https://nodejs.org/api/repl.html
	const r = repl.start({
		prompt: '> ',
		useGlobal: false,
		preview: true,
		eval: (cmd: string, context: vm.Context, _filename: string, callback: (err: Error | null, result: any) => void) => {
			try {
				const result = vm.runInContext(cmd, context);
				callback(null, result);
			} catch (e) {
				callback(e as Error, null);
			}
		}
	} as any);

	// Add all symbols to REPL context
	Object.assign(r.context, fileModule);

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

		listAvailableSymbols();
		r.displayPrompt();
	});
}

createReplServer(providedFileModule, listAvailableSymbols);
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
