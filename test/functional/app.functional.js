const Nightmare = require("nightmare");
const { expect } = require("chai");
const { setup, teardown, url } = require("../helpers/functional");

describe("Functional tests", function funcTest() {
  // Required for async mocha tests, adjust as needed
  this.timeout(15000);

  before(() => {
    setup();
  });

  after(() => {
    teardown();
  });

  // Simplest example functional test
  it("starts a test webserver", done => {
    // Promises have to be wrapped in async as Babel mucks things up
    (async () => {
      const location = await Nightmare()
        .goto(url)
        .evaluate(() => document.location.href);

      expect(location).to.equal(`${url}/`);
      done();
    })();
  });

  it("clicks through to /counter", done => {
    // Promises have to be wrapped in async as Babel mucks things up
    (async () => {
      const location = await Nightmare()
        .goto(url)
        .wait("a")
        .click('a[href="/counter"]')
        .wait(".value")
        .evaluate(() => document.location.href);

      expect(location).to.equal(`${url}/counter`);
      done();
    })();
  });

  it("increments the counter (async)", done => {
    // Promises have to be wrapped in async as Babel mucks things up
    (async () => {
      const location = await Nightmare()
        .goto(`${url}/counter`)
        .wait(".value")
        .click("button:nth-of-type(3)")
        .wait(1100)
        .evaluate(() => document.querySelector(".value").textContent);

      expect(location).to.equal("1");
      done();
    })();
  });
});
