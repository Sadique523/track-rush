export default {
	build: {
		target: 'es2022',
		rollupOptions: {
			input: {
				main: 'index.html',
				editor: 'editor.html',
			},
		},
	},
	server: {
		host: true,
		proxy: {
			'/socket.io': {
				target: 'http://localhost:3001',
				ws: true,
				changeOrigin: true,
			},
		},
	},
};
