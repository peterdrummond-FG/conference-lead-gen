using ConferenceLeadGen.Api.Data;
using ConferenceLeadGen.Api.Endpoints;
using ConferenceLeadGen.Api.Services;
using ConferenceLeadGen.Api.Tools;
using Microsoft.EntityFrameworkCore;

// Must run before WebApplication.CreateBuilder(args) — CreateBuilder snapshots
// environment variables into IConfiguration synchronously, so loading .env
// any later never reaches configuration. TraversePath() (not bare Load())
// walks up from backend/ to find the .env file at the repo root.
DotNetEnv.Env.TraversePath().Load();

if (args.Length > 0 && (args[0] == "seed-schools" || args[0] == "sync-campaigns"))
{
    var defaultPath = args[0] == "seed-schools"
        ? "Data/Seed/zoho-school-accounts.json"
        : "Data/Seed/zoho-campaigns.json";
    var jsonPath = args.Length > 1 ? args[1] : defaultPath;

    var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__Default")
        ?? throw new InvalidOperationException("ConnectionStrings__Default not set (check .env).");

    var options = new DbContextOptionsBuilder<AppDbContext>()
        .UseNpgsql(connectionString)
        .UseSnakeCaseNamingConvention()
        .Options;

    await using var db = new AppDbContext(options);

    if (args[0] == "seed-schools")
    {
        await SeedSchoolAccounts.RunAsync(db, jsonPath);
    }
    else
    {
        await SyncCampaigns.RunAsync(db, jsonPath);
    }

    return;
}

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Default"))
        .UseSnakeCaseNamingConvention());

// Dev-only safety net for direct Swagger/curl testing against the backend
// port — not load-bearing for the real kiosk flow, which only ever talks to
// the Quasar dev server's own same-origin /api proxy, never this backend
// directly. Never enabled outside Development.
builder.Services.AddCors();

// .claude/skills lives at the repo root, one level up from this project's
// own content root (backend/) — the background worker shells out to `claude`
// with this as its working directory so skills are discoverable.
var repoRoot = Directory.GetParent(builder.Environment.ContentRootPath)!.FullName;
builder.Services.AddSingleton(new MatchingOptions(repoRoot));
builder.Services.AddSingleton<MatchingQueue>();
builder.Services.AddHostedService<MatchingBackgroundService>();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
    app.UseCors(policy => policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader());
}

app.UseHttpsRedirection();

app.MapCampaignEndpoints();
app.MapEventEndpoints();
app.MapDistrictEndpoints();
app.MapSchoolEndpoints();
app.MapContactEndpoints();
app.MapExportEndpoints();

app.Run();
