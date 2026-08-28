using ConferenceLeadGen.Api.Data;
using Microsoft.EntityFrameworkCore;

// Must run before WebApplication.CreateBuilder(args) — CreateBuilder snapshots
// environment variables into IConfiguration synchronously, so loading .env
// any later never reaches configuration. TraversePath() (not bare Load())
// walks up from backend/ to find the .env file at the repo root.
DotNetEnv.Env.TraversePath().Load();

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
