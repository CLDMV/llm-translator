export function detect({ endpoint }) {
	return endpoint.url.includes("latecrash.test") ? {} : null;
}
