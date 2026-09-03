using System.Text.Json;
using System.Text.Json.Serialization;

namespace ConferenceLeadGen.Api.Common;

// Distinguishes "key omitted from a JSON PATCH body" (leave the field alone)
// from "key present with value null" (clear it) — a bare nullable property
// can't represent that distinction, since both cases deserialize to null.
// System.Text.Json only invokes a converter for a property when its key is
// present in the payload, so an omitted key leaves this at its struct
// default (HasValue: false) without any special-case "missing" logic here.
[JsonConverter(typeof(OptionalJsonConverterFactory))]
public readonly struct Optional<T>
{
    public bool HasValue { get; }
    public T? Value { get; }

    private Optional(bool hasValue, T? value)
    {
        HasValue = hasValue;
        Value = value;
    }

    public static Optional<T> Unset => default;
    public static Optional<T> Set(T? value) => new(true, value);
}

public sealed class OptionalJsonConverterFactory : JsonConverterFactory
{
    public override bool CanConvert(Type typeToConvert) =>
        typeToConvert.IsGenericType && typeToConvert.GetGenericTypeDefinition() == typeof(Optional<>);

    public override JsonConverter CreateConverter(Type typeToConvert, JsonSerializerOptions options)
    {
        var innerType = typeToConvert.GetGenericArguments()[0];
        var converterType = typeof(OptionalConverter<>).MakeGenericType(innerType);
        return (JsonConverter)Activator.CreateInstance(converterType)!;
    }

    private sealed class OptionalConverter<T> : JsonConverter<Optional<T>>
    {
        public override Optional<T> Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
            Optional<T>.Set(JsonSerializer.Deserialize<T>(ref reader, options));

        public override void Write(Utf8JsonWriter writer, Optional<T> value, JsonSerializerOptions options)
        {
            if (value.HasValue)
            {
                JsonSerializer.Serialize(writer, value.Value, options);
            }
            else
            {
                writer.WriteNullValue();
            }
        }
    }
}
