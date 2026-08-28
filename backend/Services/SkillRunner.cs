using System.Diagnostics;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace ConferenceLeadGen.Api.Services;

// Shells out to `claude -p` to invoke a Claude Code skill (research-contact,
// match-contact) headlessly. Skills are looked up relative to the working
// directory, so this must run with cwd = the repo root (where .claude/skills
// lives), never backend/.
public static class SkillRunner
{
    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public static async Task<JsonElement> RunSkillAsync(
        string skillName, object input, string repoRoot, ILogger logger, int maxAttempts = 2)
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"{Guid.NewGuid()}.json");
        await File.WriteAllTextAsync(tempPath, JsonSerializer.Serialize(input, JsonOpts));

        try
        {
            Exception? lastError = null;
            for (var attempt = 1; attempt <= maxAttempts; attempt++)
            {
                try
                {
                    return await InvokeOnceAsync(skillName, tempPath, repoRoot);
                }
                catch (Exception ex)
                {
                    lastError = ex;
                    logger.LogWarning(ex, "{Skill} attempt {Attempt}/{Max} failed", skillName, attempt, maxAttempts);
                    if (attempt < maxAttempts)
                    {
                        await Task.Delay(TimeSpan.FromSeconds(5));
                    }
                }
            }
            throw new InvalidOperationException($"{skillName} failed after {maxAttempts} attempts", lastError);
        }
        finally
        {
            try { File.Delete(tempPath); } catch { /* best effort cleanup */ }
        }
    }

    private static async Task<JsonElement> InvokeOnceAsync(string skillName, string inputPath, string repoRoot)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "claude",
            WorkingDirectory = repoRoot,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        };
        psi.ArgumentList.Add("-p");
        psi.ArgumentList.Add($"Use the {skillName} skill on the contact JSON at {inputPath}. Print only the final JSON.");
        psi.ArgumentList.Add("--dangerously-skip-permissions");

        using var process = new Process { StartInfo = psi };
        process.Start();

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(180));
        string stdout;
        try
        {
            await process.WaitForExitAsync(cts.Token);
            stdout = await process.StandardOutput.ReadToEndAsync();
        }
        catch (OperationCanceledException)
        {
            try { process.Kill(entireProcessTree: true); } catch { /* best effort */ }
            throw new TimeoutException($"{skillName} timed out after 180s");
        }

        if (process.ExitCode != 0)
        {
            var stderr = await process.StandardError.ReadToEndAsync();
            throw new InvalidOperationException($"{skillName} exited {process.ExitCode}: {stderr}");
        }

        return ExtractJson(stdout);
    }

    // Defensive: Stage 3 testing showed the skills sometimes wrap output in a
    // markdown code fence or add a leading sentence despite explicit
    // instructions not to. Scan for the first '{' and walk forward tracking
    // brace depth (respecting quoted strings/escapes) to find its match,
    // rather than trusting stdout to be pure JSON.
    internal static JsonElement ExtractJson(string text)
    {
        var start = text.IndexOf('{');
        if (start < 0)
        {
            throw new InvalidOperationException("No JSON object found in skill output");
        }

        var depth = 0;
        var inString = false;
        var escaped = false;

        for (var i = start; i < text.Length; i++)
        {
            var c = text[i];

            if (inString)
            {
                if (escaped) escaped = false;
                else if (c == '\\') escaped = true;
                else if (c == '"') inString = false;
                continue;
            }

            if (c == '"') { inString = true; continue; }
            if (c == '{') { depth++; }
            else if (c == '}')
            {
                depth--;
                if (depth == 0)
                {
                    var candidate = text[start..(i + 1)];
                    using var doc = JsonDocument.Parse(candidate);
                    return doc.RootElement.Clone();
                }
            }
        }

        throw new InvalidOperationException("Unbalanced JSON object in skill output");
    }
}
