# json.sh — JSON helpers using Node.js (no jq dependency).
# Sourced by ralphai.sh before config.sh.
#
# Node.js is always available because ralphai is an npm package.
# These helpers replace the previous jq dependency, which required
# users to install jq separately (and produced misleading errors
# when it was missing).

# _json_q <js_expression> <file> [extra_args...]
#   Reads JSON from <file>, binds it to `data`, evaluates <js_expression>.
#   Extra args are available as process.argv[2], process.argv[3], etc.
#   Returns non-zero if the file contains invalid JSON.
_json_q() {
  local expr="$1" file="$2"
  shift 2
  node -e "
    const data = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf-8'));
    $expr
  " "$file" "$@"
}

# _json_q_stdin <js_expression> [extra_args...]
#   Same as _json_q but reads JSON from stdin instead of a file.
#   Extra args are available as process.argv[1], process.argv[2], etc.
_json_q_stdin() {
  local expr="$1"
  shift
  node -e "
    let d = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', c => d += c);
    process.stdin.on('end', () => { const data = JSON.parse(d); $expr });
  " "$@"
}
