import { CompiledRoutine } from 'cwise-parser';
import { Procedure } from './index';
import * as uniq from "uniq";

// This function generates very simple loops analogous to how you typically traverse arrays (the outermost loop corresponds to the slowest changing index, the innermost loop to the fastest changing index)
// TODO: If two arrays have the same strides (and offsets) there is potential for decreasing the number of "pointers" and related variables. The drawback is that the type signature would become more specific and that there would thus be less potential for caching, but it might still be worth it, especially when dealing with large numbers of arguments.
function innerFill(order: number[], proc: Procedure, body: string) {
	const dimension = order.length;
	const nargs = proc.arrayArgs.length;
	const has_index = proc.indexArgs.length > 0;
	const code = [] as string[];
	const vars = [] as string[];
	let idx = 0, pidx = 0;
	for (let i = 0; i < dimension; ++i) { // Iteration variables
		vars.push(["i", i, "=0"].join(""));
	}
	//Compute scan deltas
	for (let j = 0; j < nargs; ++j) {
		for (let i = 0; i < dimension; ++i) {
			pidx = idx;
			idx = order[i];
			if (i === 0) { // The innermost/fastest dimension's delta is simply its stride
				vars.push(["d", j, "s", i, "=t", j, "p", idx].join(""));
			} else { // For other dimensions the delta is basically the stride minus something which essentially "rewinds" the previous (more inner) dimension
				vars.push(["d", j, "s", i, "=(t", j, "p", idx, "-s", pidx, "*t", j, "p", pidx, ")"].join(""));
			}
		}
	}
	code.push("var " + vars.join(","));
	//Scan loop
	for (let i = dimension - 1; i >= 0; --i) { // Start at largest stride and work your way inwards
		idx = order[i];
		code.push(["for(i", i, "=0;i", i, "<s", idx, ";++i", i, "){"].join(""));
	}
	//Push body of inner loop
	code.push(body);
	//Advance scan pointers
	for (let i = 0; i < dimension; ++i) {
		pidx = idx
		idx = order[i];
		for (let j = 0; j < nargs; ++j) {
			code.push(["p", j, "+=d", j, "s", i].join(""));
		}
		if (has_index) {
			if (i > 0) {
				code.push(["index[", pidx, "]-=s", pidx].join(""));
			}
			code.push(["++index[", idx, "]"].join(""));
		}
		code.push("}");
	}
	return code.join("\n");
}

// Generate "outer" loops that loop over blocks of data, applying "inner" loops to the blocks by manipulating the local variables in such a way that the inner loop only "sees" the current block.
// TODO: If this is used, then the previous declaration (done by generateCwiseOp) of s* is essentially unnecessary.
//       I believe the s* are not used elsewhere (in particular, I don't think they're used in the pre/post parts and "shape" is defined independently), so it would be possible to make defining the s* dependent on what loop method is being used.
function outerFill(matched: number, order: number[], proc: Procedure, body: string) {
	const dimension = order.length;
	const nargs = proc.arrayArgs.length;
	const blockSize = proc.blockSize;
	const has_index = proc.indexArgs.length > 0;
	const code = [] as string[];
	for (let i = 0; i < nargs; ++i) {
		code.push(["var offset", i, "=p", i].join(""));
	}
	//Generate loops for unmatched dimensions
	// The order in which these dimensions are traversed is fairly arbitrary (from small stride to large stride, for the first argument)
	// TODO: It would be nice if the order in which these loops are placed would also be somehow "optimal" (at the very least we should check that it really doesn't hurt us if they're not).
	for (let i = matched; i < dimension; ++i) {
		code.push(["for(var j" + i + "=SS[", order[i], "]|0;j", i, ">0;){"].join("")); // Iterate back to front
		code.push(["if(j", i, "<", blockSize, "){"].join("")); // Either decrease j by blockSize (s = blockSize), or set it to zero (after setting s = j).
		code.push(["s", order[i], "=j", i].join(""));
		code.push(["j", i, "=0"].join(""));
		code.push(["}else{s", order[i], "=", blockSize].join(""));
		code.push(["j", i, "-=", blockSize, "}"].join(""));
		if (has_index) {
			code.push(["index[", order[i], "]=j", i].join(""));
		}
	}
	for (let i = 0; i < nargs; ++i) {
		const indexStr = ["offset" + i];
		for (let j = matched; j < dimension; ++j) {
			indexStr.push(["j", j, "*t", i, "p", order[j]].join(""));
		}
		code.push(["p", i, "=(", indexStr.join("+"), ")"].join(""));
	}
	code.push(innerFill(order, proc, body));
	for (let i = matched; i < dimension; ++i) {
		code.push("}");
	}
	return code.join("\n");
}

//Count the number of compatible inner orders
// This is the length of the longest common prefix of the arrays in orders.
// Each array in orders lists the dimensions of the correspond ndarray in order of increasing stride.
// This is thus the maximum number of dimensions that can be efficiently traversed by simple nested loops for all arrays.
function countMatches(orders: number[][]) {
	let matched = 0;
	let dimension = orders[0].length;
	while (matched < dimension) {
		for (let j = 1; j < orders.length; ++j) {
			if (orders[j][matched] !== orders[0][matched]) {
				return matched;
			}
		}
		++matched;
	}
	return matched;
}

//Processes a block according to the given data types
// Replaces variable names by different ones, either "local" ones (that are then ferried in and out of the given array) or ones matching the arguments that the function performing the ultimate loop will accept.
function processBlock(block: CompiledRoutine, proc: Procedure, dtypes: string[]) {
	let code = block.body;
	const pre = [] as string[];
	const post = [] as string[];
	block.args.forEach((carg, i) => {
		if (carg.count <= 0) {
			return;
		}
		const re = new RegExp(carg.name, "g");
		let ptrStr = "";
		let arrNum = proc.arrayArgs.indexOf(i);
		switch (proc.argTypes[i]) {
			case "offset":
				const offArgIndex = proc.offsetArgIndex.indexOf(i);
				const offArg = proc.offsetArgs[offArgIndex];
				arrNum = offArg.array;
				ptrStr = "+q" + offArgIndex; // Adds offset to the "pointer" in the array
			case "array":
				ptrStr = "p" + arrNum + ptrStr;
				const localStr = "l" + i;
				const arrStr = "a" + arrNum;
				if (proc.arrayBlockIndices[arrNum] === 0) { // Argument to body is just a single value from this array
					if (carg.count === 1) { // Argument/array used only once(?)
						if (dtypes[arrNum] === "generic") {
							if (carg.lvalue) {
								pre.push(["var ", localStr, "=", arrStr, ".get(", ptrStr, ")"].join("")) // Is this necessary if the argument is ONLY used as an lvalue? (keep in mind that we can have a += something, so we would actually need to check carg.rvalue)
								code = code.replace(re, localStr)
								post.push([arrStr, ".set(", ptrStr, ",", localStr, ")"].join(""))
							} else {
								code = code.replace(re, [arrStr, ".get(", ptrStr, ")"].join(""))
							}
						} else {
							code = code.replace(re, [arrStr, "[", ptrStr, "]"].join(""))
						}
					} else if (dtypes[arrNum] === "generic") {
						pre.push(["var ", localStr, "=", arrStr, ".get(", ptrStr, ")"].join("")) // TODO: Could we optimize by checking for carg.rvalue?
						code = code.replace(re, localStr)
						if (carg.lvalue) {
							post.push([arrStr, ".set(", ptrStr, ",", localStr, ")"].join(""))
						}
					} else {
						pre.push(["var ", localStr, "=", arrStr, "[", ptrStr, "]"].join("")) // TODO: Could we optimize by checking for carg.rvalue?
						code = code.replace(re, localStr)
						if (carg.lvalue) {
							post.push([arrStr, "[", ptrStr, "]=", localStr].join(""))
						}
					}
				} else { // Argument to body is a "block"
					const reStrArr = [carg.name], ptrStrArr = [ptrStr]
					for (let j = 0; j < Math.abs(proc.arrayBlockIndices[arrNum]); j++) {
						reStrArr.push("\\s*\\[([^\\]]+)\\]")
						ptrStrArr.push("$" + (j + 1) + "*t" + arrNum + "b" + j) // Matched index times stride
					}
					const re = new RegExp(reStrArr.join(""), "g")
					ptrStr = ptrStrArr.join("+")
					if (dtypes[arrNum] === "generic") {
						/*if(carg.lvalue) {
						  pre.push(["var ", localStr, "=", arrStr, ".get(", ptrStr, ")"].join("")) // Is this necessary if the argument is ONLY used as an lvalue? (keep in mind that we can have a += something, so we would actually need to check carg.rvalue)
						  code = code.replace(re, localStr)
						  post.push([arrStr, ".set(", ptrStr, ",", localStr,")"].join(""))
						} else {
						  code = code.replace(re, [arrStr, ".get(", ptrStr, ")"].join(""))
						}*/
						throw new Error("cwise: Generic arrays not supported in combination with blocks!");
					} else {
						// This does not produce any local variables, even if variables are used multiple times. It would be possible to do so, but it would complicate things quite a bit.
						code = code.replace(re, [arrStr, "[", ptrStr, "]"].join(""));
					}
				}
				break;
			case "scalar":
				code = code.replace(re, "Y" + proc.scalarArgs.indexOf(i));
				break;
			case "index":
				code = code.replace(re, "index");
				break;
			case "shape":
				code = code.replace(re, "shape");
				break;
		}
	});
	return [pre.join("\n"), code, post.join("\n")].join("\n").trim();
}

function typeSummary(dtypes: string[]) {
	const summary = new Array<string>(dtypes.length);
	let allEqual = true;
	dtypes.forEach((t, i) => {
		const n = t.match(/\d+/);
		const digits = n ? n[0] : '';
		if (t.charAt(0) === '0') {
			summary[i] = "u" + t.charAt(1) + digits;
		} else {
			summary[i] = t.charAt(0) + digits;
		}
		if (i > 0) {
			allEqual = allEqual && summary[i] === summary[i - 1];
		}
	});
	if (allEqual) {
		return summary[0];
	}
	return summary.join("");
}

//Generates a cwise operator
export default function generateCWiseOp(proc: Procedure, typesig: (string | string[])[]) {

	//Compute dimension
	// Arrays get put first in typesig, and there are two entries per array (dtype and order), so this gets the number of dimensions in the first array arg.
	const dimension = (typesig[1].length - Math.abs(proc.arrayBlockIndices[0])) | 0;
	const arrayArgs = proc.arrayArgs;
	const orders = arrayArgs.map((arrayArg, i) => {
		return typesig[2 * i + 1] as string[];
	});
	const dtypes = arrayArgs.map((arrayArg, i) => {
		return typesig[2 * i] as string;
	});

	//Determine where block and loop indices start and end
	const blockBegin = [] as number[];
	const blockEnd = [] as number[]; // These indices are exposed as blocks
	const loopBegin = [] as number[];
	const loopEnd = [] as number[]; // These indices are iterated over
	const loopOrders = [] as number[][]; // orders restricted to the loop indices
	arrayArgs.forEach((arg, i) => {
		if (proc.arrayBlockIndices[i] < 0) {
			loopBegin.push(0);
			loopEnd.push(dimension);
			blockBegin.push(dimension);
			blockEnd.push(dimension + proc.arrayBlockIndices[i]);
		} else {
			loopBegin.push(proc.arrayBlockIndices[i]); // Non-negative
			loopEnd.push(proc.arrayBlockIndices[i] + dimension);
			blockBegin.push(0);
			blockEnd.push(proc.arrayBlockIndices[i]);
		}
		const newOrder = [] as number[];
		for (let j = 0; j < orders[i].length; j++) {
			const order = orders[i][j] as any as number;
			if (loopBegin[i] <= order && order < loopEnd[i]) {
				newOrder.push(order - loopBegin[i]); // If this is a loop index, put it in newOrder, subtracting loopBegin, to make sure that all loopOrders are using a common set of indices.
			}
		}
		loopOrders.push(newOrder);
	});

	//First create arguments for procedure
	const arglist = ["SS"]; // SS is the overall shape over which we iterate
	const code = ["'use strict'"];
	const vars = [] as string[];

	for (let j = 0; j < dimension; ++j) {
		vars.push(["s", j, "=SS[", j, "]"].join("")) // The limits for each dimension.
	}
	arrayArgs.forEach((arg, i) => {
		arglist.push("a" + i); // Actual data array
		arglist.push("t" + i); // Strides
		arglist.push("p" + i); // Offset in the array at which the data starts (also used for iterating over the data)

		for (let j = 0; j < dimension; ++j) { // Unpack the strides into vars for looping
			vars.push(["t", i, "p", j, "=t", i, "[", loopBegin[i] + j, "]"].join(""))
		}

		for (let j = 0; j < Math.abs(proc.arrayBlockIndices[i]); ++j) { // Unpack the strides into vars for block iteration
			vars.push(["t", i, "b", j, "=t", i, "[", blockBegin[i] + j, "]"].join(""))
		}
	});
	arglist.push(...proc.scalarArgs.map((scalar, i) => {
		return "Y" + i;
	}));
	if (proc.shapeArgs.length > 0) {
		vars.push("shape=SS.slice(0)"); // Makes the shape over which we iterate available to the user defined functions (so you can use width/height for example)
	}
	if (proc.indexArgs.length > 0) {
		// Prepare an array to keep track of the (logical) indices, initialized to dimension zeroes.
		const zeros = new Array<string>(dimension);
		for (let i = 0; i < dimension; ++i) {
			zeros[i] = "0";
		}
		vars.push(["index=[", zeros.join(","), "]"].join(""))
	}
	vars.push(...proc.offsetArgs.map((off_arg, i) => {
		const init_string = []
		for (let j = 0; j < off_arg.offset.length; ++j) {
			if (off_arg.offset[j] === 0) {
				continue
			} else if (off_arg.offset[j] === 1) {
				init_string.push(["t", off_arg.array, "p", j].join(""))
			} else {
				init_string.push([off_arg.offset[j], "*t", off_arg.array, "p", j].join(""))
			}
		}
		if (init_string.length === 0) {
			return "q" + i + "=0";
		} else {
			return ["q", i, "=", init_string.join("+")].join("");
		}
	}));

	//Prepare this variables
	const thisVars = uniq(([] as string[]).concat(proc.pre.thisVars)
		.concat(proc.body.thisVars)
		.concat(proc.post.thisVars));
	code.push("const " + vars.concat(thisVars).join(","));
	code.push(...proc.arrayArgs.map((arg, i) => {
		return "p" + i + "|=0";
	}));

	//Inline prelude
	if (proc.pre.body.length > 3) {
		code.push(processBlock(proc.pre, proc, dtypes))
	}

	//Process body
	const body = processBlock(proc.body, proc, dtypes)
	const matched = countMatches(loopOrders)
	if (matched < dimension) {
		code.push(outerFill(matched, loopOrders[0], proc, body)) // TODO: Rather than passing loopOrders[0], it might be interesting to look at passing an order that represents the majority of the arguments for example.
	} else {
		code.push(innerFill(loopOrders[0], proc, body))
	}

	//Inline epilog
	if (proc.post.body.length > 3) {
		code.push(processBlock(proc.post, proc, dtypes))
	}

	if (proc.debug) {
		console.log("-----Generated cwise routine for ", typesig, ":\n" + code.join("\n") + "\n----------")
	}

	const loopName = [(proc.funcName || "unnamed"), "_cwise_loop_", orders[0].join("s"), "m", matched, typeSummary(dtypes)].join("")
	const f = new Function(["function ", loopName, "(", arglist.join(","), "){", code.join("\n"), "} return ", loopName].join(""))
	return f()
}
