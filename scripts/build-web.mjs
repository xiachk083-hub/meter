import esbuild from 'esbuild'

const isWatch = process.argv.includes('--watch')

const common = {
  entryPoints: ['web/main.jsx'],
  bundle: true,
  outfile: 'public/assets/bundle.js',
  minify: true,
  sourcemap: !isWatch,
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.jsx': 'jsx' },
  target: ['es2018']
}

if (isWatch) {
  const ctx = await esbuild.context(common)
  await ctx.watch()
  console.log('watching web sources...')
} else {
  await esbuild.build(common)
  console.log('built public/assets/bundle.js')
}