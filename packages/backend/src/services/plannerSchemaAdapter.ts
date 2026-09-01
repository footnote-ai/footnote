/**
 * @description: Projects canonical planner contract schema into provider-safe tool parameter schemas.
 * @footnote-scope: utility
 * @footnote-module: PlannerSchemaAdapter
 * @footnote-risk: medium - Incorrect projection can cause provider-side planner call rejection.
 * @footnote-ethics: medium - Schema projection quality affects planner reliability and user trust in responses.
 */

const removeTopLevelCombinators = (
    schema: Record<string, unknown>
): Record<string, unknown> => {
    const projectedSchema = { ...schema };
    delete projectedSchema.allOf;
    delete projectedSchema.anyOf;
    delete projectedSchema.oneOf;
    return projectedSchema;
};

const addNullToType = (type: unknown): unknown => {
    if (typeof type === 'string') {
        return [type, 'null'];
    }
    if (Array.isArray(type) && type.every((item) => typeof item === 'string')) {
        return Array.from(new Set([...type, 'null']));
    }
    return type;
};

const projectNullableSchema = (schema: unknown): unknown => {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
        return schema;
    }

    const source = schema as Record<string, unknown>;
    const projected: Record<string, unknown> = { ...source };
    if (Array.isArray(source.enum) && !source.enum.includes(null)) {
        projected.enum = [...source.enum, null];
        delete projected.type;
    } else if (source.type !== undefined) {
        projected.type = addNullToType(source.type);
    }

    if (source.properties && typeof source.properties === 'object') {
        const sourceProperties = source.properties as Record<string, unknown>;
        const projectedProperties: Record<string, unknown> = {};
        for (const [key, propertySchema] of Object.entries(sourceProperties)) {
            projectedProperties[key] = projectNullableSchema(propertySchema);
        }
        projected.properties = projectedProperties;
        projected.required = Object.keys(projectedProperties);
        projected.additionalProperties = false;
    }

    if (source.items !== undefined) {
        const itemSchema = projectNullableSchema(source.items);
        if (
            itemSchema &&
            typeof itemSchema === 'object' &&
            !Array.isArray(itemSchema)
        ) {
            const projectedItem = itemSchema as Record<string, unknown>;
            if (Array.isArray(projectedItem.enum)) {
                projectedItem.enum = projectedItem.enum.filter(
                    (item) => item !== null
                );
            }
            if (Array.isArray(projectedItem.type)) {
                projectedItem.type = projectedItem.type.filter(
                    (item) => item !== 'null'
                );
            }
        }
        projected.items = itemSchema;
    }

    return projected;
};

/**
 * Projects the canonical planner contract into the strict, provider-safe
 * shape used by OpenRouter structured output. Optional planner values remain
 * required at the transport layer, but accept null so no policy fact is
 * invented by the adapter.
 */
export const projectPlannerSchemaForStrictOutput = (
    canonicalSchema: Record<string, unknown>
): Record<string, unknown> => {
    const projected = projectNullableSchema(
        removeTopLevelCombinators(canonicalSchema)
    );
    if (
        !projected ||
        typeof projected !== 'object' ||
        Array.isArray(projected)
    ) {
        return removeTopLevelCombinators(canonicalSchema);
    }

    const root = projected as Record<string, unknown>;
    if (
        root.type === 'object' ||
        (Array.isArray(root.type) && root.type.includes('object'))
    ) {
        root.type = 'object';
        const properties = root.properties;
        if (
            properties &&
            typeof properties === 'object' &&
            !Array.isArray(properties)
        ) {
            root.required = Object.keys(properties as Record<string, unknown>);
        }
    }
    return root;
};

/** Removes transport-only nulls before the canonical planner normalizer runs. */
export const removePlannerTransportNulls = (value: unknown): unknown => {
    if (Array.isArray(value)) {
        return value.map(removePlannerTransportNulls);
    }
    if (!value || typeof value !== 'object') {
        return value;
    }

    const result: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
        if (nestedValue !== null) {
            result[key] = removePlannerTransportNulls(nestedValue);
        }
    }
    return result;
};

export const projectPlannerSchemaForProvider = (
    canonicalSchema: Record<string, unknown>
): Record<string, unknown> => removeTopLevelCombinators(canonicalSchema);
