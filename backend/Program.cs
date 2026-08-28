using ConferenceLeadGen.Api.Data;
using ConferenceLeadGen.Api.Tools;
using Microsoft.EntityFrameworkCore;

// Must run before WebApplication.CreateBuilder(args) — CreateBuilder snapshots
// environment variables into IConfiguration synchronously, so loading .env
// any later never reaches configuration. TraversePath() (not bare Load())
// walks up from backend/ to find the .env file at the repo root.
DotNetEnv.Env.TraversePath().Load();

if (args.Length > 0 && args[0] == "seed-schools")
{
    var jsonPath = args.Length > 1 ? args[1] : "Data/Seed/zoho-school-accounts.json";

    var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__Default")
        ?? throw new InvalidOperationException("ConnectionStrings__Default not set (check .env).");

    var options = new DbContextOptionsBuilder<AppDbContext>()
        .UseNpgsql(connectionString)
        .UseSnakeCaseNamingConvention()
        .Options;

    await using var db = new AppDbContext(options);
    await SeedSchoolAccounts.RunAsync(db, jsonPath);
    return;
}

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Default"))
        .UseSnakeCaseNamingConvention());

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();

app.Run();
