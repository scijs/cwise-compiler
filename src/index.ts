import { CompiledRoutine } from 'cwise-parser';

import createThunk from './thunk';

export interface BlockIndice {
	blockIndices: number;
}

export interface OffsetArg {
	offset: number[];
	array: number;
}

export type ArgType = 'array' | 'offset' | 'shape' | 'scalar' | 'index' | BlockIndice | OffsetArg;

export interface UserArgs {
	args: ArgType[];
	pre: CompiledRoutine;
	body: CompiledRoutine,
	post: CompiledRoutine;
	debug: boolean;
	funcName: string;
	blockSize: number;
	printCode?: boolean;
}

export interface Procedure {
	argTypes: ArgType[];
	shimArgs: string[];
	arrayArgs: number[];
	arrayBlockIndices: number[];
	scalarArgs: number[];
	offsetArgs: OffsetArg[];
	offsetArgIndex: number[];
	indexArgs: number[];
	shapeArgs: number[];
	funcName: string;
	pre: CompiledRoutine;
	body: CompiledRoutine;
	post: CompiledRoutine;
	debug: boolean;
	blockSize?: number;
}

export default function compileCwise(user_args: UserArgs) {
	const proc_args = user_args.args.slice(0);
	// Create procedure and parse blocks
	const proc = {
		argTypes: proc_args,
		shimArgs: [],
		arrayArgs: [],
		arrayBlockIndices: [],
		scalarArgs: [],
		offsetArgs: [],
		offsetArgIndex: [],
		indexArgs: [],
		shapeArgs: [],
		funcName: "",
		pre: user_args.pre,
		body: user_args.body,
		post: user_args.post,
		debug: false
	} as Procedure;

	// Parse arguments
	proc_args.forEach((arg_type, i) => {
		if (arg_type === "array" || (typeof arg_type === "object" && (arg_type as BlockIndice).blockIndices)) {
			const bi = (arg_type as BlockIndice).blockIndices;
			proc.argTypes[i] = "array";
			proc.arrayArgs.push(i);
			proc.arrayBlockIndices.push(bi ? bi : 0);
			proc.shimArgs.push("array" + i);
			if (i < proc.pre.args.length && proc.pre.args[i].count > 0) {
				throw new Error("cwise: pre() block may not reference array args");
			}
			if (i < proc.post.args.length && proc.post.args[i].count > 0) {
				throw new Error("cwise: post() block may not reference array args");
			}
		} else if (arg_type === "scalar") {
			proc.scalarArgs.push(i);
			proc.shimArgs.push("scalar" + i);
		} else if (arg_type === "index") {
			proc.indexArgs.push(i);
			if (i < proc.pre.args.length && proc.pre.args[i].count > 0) {
				throw new Error("cwise: pre() block may not reference array index");
			}
			if (i < proc.body.args.length && proc.body.args[i].lvalue) {
				throw new Error("cwise: body() block may not write to array index");
			}
			if (i < proc.post.args.length && proc.post.args[i].count > 0) {
				throw new Error("cwise: post() block may not reference array index");
			}
		} else if (arg_type === "shape") {
			proc.shapeArgs.push(i);
			if (i < proc.pre.args.length && proc.pre.args[i].lvalue) {
				throw new Error("cwise: pre() block may not write to array shape");
			}
			if (i < proc.body.args.length && proc.body.args[i].lvalue) {
				throw new Error("cwise: body() block may not write to array shape");
			}
			if (i < proc.post.args.length && proc.post.args[i].lvalue) {
				throw new Error("cwise: post() block may not write to array shape");
			}
		} else if (typeof arg_type === "object" && (arg_type as OffsetArg).offset) {
			const offsetarg = arg_type as OffsetArg;
			proc.argTypes[i] = "offset";
			proc.offsetArgs.push({ array: offsetarg.array, offset: offsetarg.offset });
			proc.offsetArgIndex.push(i);
		} else {
			throw new Error("cwise: Unknown argument type " + proc_args[i]);
		}
	});

	// Make sure at least one array argument was specified
	if (proc.arrayArgs.length <= 0) {
		throw new Error("cwise: No array arguments specified")
	}

	// Make sure arguments are correct
	if (proc.pre.args.length > proc_args.length) {
		throw new Error("cwise: Too many arguments in pre() block")
	}
	if (proc.body.args.length > proc_args.length) {
		throw new Error("cwise: Too many arguments in body() block")
	}
	if (proc.post.args.length > proc_args.length) {
		throw new Error("cwise: Too many arguments in post() block")
	}

	// Check debug flag
	proc.debug = !!user_args.printCode || !!user_args.debug;

	// Retrieve name
	proc.funcName = user_args.funcName || "cwise";

	// Read in block size
	proc.blockSize = user_args.blockSize || 64;

	return createThunk(proc);
}
