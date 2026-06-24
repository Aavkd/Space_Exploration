export function disposeObject3D(root) {
    root.traverse((object) => {
        if (object.geometry) object.geometry.dispose();

        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
            if (!material) continue;
            for (const value of Object.values(material)) {
                if (value?.isTexture) value.dispose();
            }
            material.dispose?.();
        }
    });
}
