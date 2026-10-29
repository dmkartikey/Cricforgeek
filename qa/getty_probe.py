import sys, time
src = open("qa/getty_lib.py").read().split("\ncon = duckdb.connect")[0]
src = src.replace("work, out, cache = sys.argv[1:4]", "work, out, cache = '.', 'out', 'out'").replace("import duckdb", "")
g = {}; exec(src, g)
for nm, team in (("Abhishek Sharma", "India"), ("Nicholas Pooran", "West Indies"), ("Heinrich Klaasen", "South Africa"), ("Rinku Singh", "India")):
    t = time.time(); e = g["find"](nm, team)
    print(f"::notice::getty find {nm}: {e} ({time.time() - t:.0f}s)"[:400])
