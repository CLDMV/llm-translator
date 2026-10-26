export function detect({ endpoint }) {
	return endpoint.url.includes("lateknown.test") ? {} : null;
}
